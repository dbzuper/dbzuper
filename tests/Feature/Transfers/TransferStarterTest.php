<?php

use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Enums\TransferStatus;
use App\Models\SavedConnection;
use App\Models\Transfer;
use App\Transfers\TransferConflict;
use App\Transfers\TransferStarter;

function startTestTransfer(SavedConnection $c, TransferDirection $d = TransferDirection::Export): Transfer
{
    return TransferStarter::start($c, $c->user, $d, TransferMethod::Builtin, [], 'dump.sql', null);
}

it('refuses a second active transfer on the same database', function () {
    $c = SavedConnection::factory()->create();
    startTestTransfer($c);

    expect(fn () => startTestTransfer($c, TransferDirection::Import))
        ->toThrow(TransferConflict::class, 'A backup of this database is already running');
});

it('names a running restore in the conflict message', function () {
    $c = SavedConnection::factory()->create();
    startTestTransfer($c, TransferDirection::Import);

    expect(fn () => startTestTransfer($c))->toThrow(TransferConflict::class, 'A restore of this database is already running');
});

it('allows transfers on different databases of one server connection', function () {
    $server = SavedConnection::factory()->create(['database' => '']);

    startTestTransfer($server->forDatabase('one'));
    $second = startTestTransfer($server->forDatabase('two'));

    expect($second->database)->toBe('two')
        ->and($second->status)->toBe(TransferStatus::Pending);
});

it('allows a new transfer once the previous one finished', function () {
    $c = SavedConnection::factory()->create();
    startTestTransfer($c)->forceFill(['status' => TransferStatus::Done, 'finished_at' => now()])->save();

    expect(startTestTransfer($c)->status)->toBe(TransferStatus::Pending);
});

it('records the initial status and sizes', function () {
    $c = SavedConnection::factory()->create();
    $t = TransferStarter::start($c, $c->user, TransferDirection::Import, TransferMethod::Native, ['gzip' => true], 'a.sql', 42, TransferStatus::Uploading);

    expect($t->status)->toBe(TransferStatus::Uploading)
        ->and($t->bytes_total)->toBe(42)
        ->and($t->options)->toBe(['gzip' => true])
        ->and($t->file_name)->toBe('a.sql');
});

it('no longer lets an abandoned upload block a new transfer', function () {
    config(['dbzuper.transfer_upload_idle_minutes' => 10]);
    $c = SavedConnection::factory()->create();
    $stale = TransferStarter::start($c, $c->user, TransferDirection::Import, TransferMethod::Builtin, [], 'a.sql', 42, TransferStatus::Uploading);
    $stale->forceFill(['updated_at' => now()->subMinutes(11)])->saveQuietly();

    expect(startTestTransfer($c)->status)->toBe(TransferStatus::Pending)
        ->and($stale->fresh()->status)->toBe(TransferStatus::Failed)
        ->and($stale->fresh()->error)->toBe('Upload abandoned');
});

it('still refuses a new transfer while an upload is receiving chunks', function () {
    config(['dbzuper.transfer_upload_idle_minutes' => 10]);
    $c = SavedConnection::factory()->create();
    $recent = TransferStarter::start($c, $c->user, TransferDirection::Import, TransferMethod::Builtin, [], 'a.sql', 42, TransferStatus::Uploading);
    $recent->forceFill(['updated_at' => now()->subMinutes(9)])->saveQuietly();

    expect(fn () => startTestTransfer($c))->toThrow(TransferConflict::class, 'A restore of this database is already running');
    expect($recent->fresh()->status)->toBe(TransferStatus::Uploading);
});
