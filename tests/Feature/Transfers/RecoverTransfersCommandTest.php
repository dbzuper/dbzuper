<?php

use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Enums\TransferStatus;
use App\Models\SavedConnection;
use App\Models\Transfer;
use App\Transfers\TransferStorage;
use Illuminate\Support\Facades\File;

afterEach(fn () => File::deleteDirectory(storage_path('app/private/transfers')));

function recoverableTransfer(TransferStatus $status, ?string $host): Transfer
{
    $connection = SavedConnection::factory()->create();
    $t = Transfer::create([
        'user_id' => $connection->user_id,
        'saved_connection_id' => $connection->id,
        'database' => '',
        'direction' => TransferDirection::Export,
        'method' => TransferMethod::Builtin,
        'options' => [],
        'file_name' => 'dump.sql',
        'status' => $status,
    ]);
    $path = TransferStorage::directory($t).'/dump.sql';
    file_put_contents($path, 'partial');
    $t->forceFill(['file_path' => $path, 'file_size' => 7, 'worker_host' => $host, 'worker_pid' => 4242])->save();

    return $t;
}

it('fails running transfers of this host and removes their files', function () {
    $here = recoverableTransfer(TransferStatus::Running, gethostname());
    $elsewhere = recoverableTransfer(TransferStatus::Running, 'another-host');
    $pending = recoverableTransfer(TransferStatus::Pending, gethostname());
    $done = recoverableTransfer(TransferStatus::Done, gethostname());

    $this->artisan('dbzuper:transfers:recover')
        ->expectsOutput('Marked 1 interrupted backup or restore as failed.')
        ->assertSuccessful();

    $here->refresh();
    expect($here->status)->toBe(TransferStatus::Failed)
        ->and($here->error)->toBe('The server restarted while this was running.')
        ->and($here->finished_at)->not->toBeNull()
        ->and($here->file_path)->toBeNull()
        ->and(is_dir(storage_path('app/private/transfers/'.$here->id)))->toBeFalse();

    foreach ([$elsewhere, $pending, $done] as $untouched) {
        $fresh = $untouched->fresh();
        expect($fresh->status)->toBe($untouched->status)
            ->and($fresh->error)->toBeNull()
            ->and(is_file($untouched->file_path))->toBeTrue();
    }
});

it('prints nothing when no transfer was interrupted', function () {
    $this->artisan('dbzuper:transfers:recover')->doesntExpectOutputToContain('Marked')->assertSuccessful();
});
