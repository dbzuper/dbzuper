<?php

use App\Enums\DriverName;
use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Enums\TransferStatus;
use App\Jobs\RunExport;
use App\Models\SavedConnection;
use App\Models\Transfer;
use App\Models\User;
use App\Support\Demo\CommerceSchema;
use App\Transfers\Export\BuiltinExporter;
use App\Transfers\Export\BuiltinExporters;
use App\Transfers\Export\ExportOptions;
use App\Transfers\Io\DumpWriter;
use App\Transfers\TransferProgress;
use App\Transfers\TransferStorage;
use App\Transfers\WorkerHeartbeat;
use Carbon\CarbonImmutable;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;
use Tests\Support\Engines;

class ThrowingExporter implements BuiltinExporter
{
    public static ?Throwable $error = null;

    public function export(Connection $db, ExportOptions $o, DumpWriter $w, TransferProgress $p): void
    {
        $w->write(str_repeat('-- partial', 100));
        expect(file_exists($w->path()))->toBeTrue()
            ->and(Transfer::query()->sole()->file_path)->toBe($w->path());

        throw self::$error ?? new RuntimeException('boom');
    }

    public function gaps(): array
    {
        return [];
    }
}

beforeEach(function () {
    $this->user = User::factory()->create();
    $path = Engines::sqlitePath();
    $db = DB::connectUsing('fixture', ['driver' => 'sqlite', 'database' => $path, 'prefix' => '', 'foreign_key_constraints' => true], force: true);
    CommerceSchema::create($db);
    DB::purge('fixture');

    $this->connection = SavedConnection::factory()->for($this->user)->create([
        'driver' => DriverName::Sqlite, 'host' => null, 'port' => null, 'database' => $path, 'username' => null, 'password' => null,
    ]);
    $this->path = $path;
    $this->base = "/api/c/{$this->connection->id}/transfers";
    Queue::fake();
});

afterEach(function () {
    foreach (Transfer::query()->get() as $t) {
        TransferStorage::deleteFiles($t);
    }
    Engines::resetSqlite();
});

function startExport(array $body = []): TestResponse
{
    return test()->actingAs(test()->user)->postJson(test()->base.'/export', $body + [
        'tables' => 'all', 'structure' => true, 'data' => true, 'drop' => false, 'gzip' => true,
    ]);
}

/** The bytes a (binary file) response sends. */
function sentBytes(TestResponse $response): string
{
    ob_start();
    $response->baseResponse->sendContent();

    return (string) ob_get_clean();
}

function runExport(string $id): Transfer
{
    (new RunExport($id))->handle();

    return Transfer::query()->findOrFail($id);
}

it('starts an export and queues it on the transfers connection', function () {
    $json = startExport()->assertAccepted()->json();

    $stem = pathinfo($this->path, PATHINFO_FILENAME);
    expect($json['status'])->toBe('pending')
        ->and($json['direction'])->toBe('export')
        ->and($json['method'])->toBe('builtin')
        ->and($json['file_name'])->toMatch('/^'.preg_quote($stem, '/').'-\d{8}-\d{6}\.sql\.gz$/')
        ->and($json)->not->toHaveKey('file_path');

    Queue::assertPushed(RunExport::class, fn (RunExport $job) => $job->transferId === $json['id']
        && $job->connection === 'transfers' && $job->queue === 'transfers');

    $transfer = Transfer::query()->findOrFail($json['id']);
    expect($transfer->options)->toMatchArray(['tables' => null, 'structure' => true, 'data' => true, 'drop' => false, 'gzip' => true])
        ->and($transfer->options['method_reason'])->toBe('SQLite always uses the built-in method')
        ->and($transfer->user_id)->toBe($this->user->id)
        ->and($transfer->database)->toBe('');
});

it('names the file with the app timezone and no .gz when uncompressed', function () {
    config(['app.timezone' => 'Asia/Jakarta']);
    $this->travelTo(CarbonImmutable::parse('2026-11-22 20:30:15', 'UTC'));

    $json = startExport(['gzip' => false])->assertAccepted()->json();

    expect($json['file_name'])->toBe(pathinfo($this->path, PATHINFO_FILENAME).'-20261123-033015.sql');
});

it('validates the request', function () {
    startExport(['structure' => false, 'data' => false])->assertUnprocessable()->assertJsonValidationErrors('data');
    startExport(['tables' => ['users', 'nope']])->assertUnprocessable()->assertJsonValidationErrors('tables');
    startExport(['tables' => 'some'])->assertUnprocessable()->assertJsonValidationErrors('tables');
    startExport(['method' => 'magic'])->assertUnprocessable()->assertJsonValidationErrors('method');
    startExport(['method' => 'native'])->assertUnprocessable();

    expect(Transfer::query()->count())->toBe(0);
});

it('runs to a downloadable gzip file', function () {
    // A snapshot gives the row total.
    $this->actingAs($this->user)->getJson("/api/c/{$this->connection->id}/schema")->assertOk();
    $id = startExport()->json('id');

    $transfer = runExport($id);

    expect($transfer->status)->toBe(TransferStatus::Done)
        ->and($transfer->file_path)->toStartWith(TransferStorage::directory($transfer))
        ->and($transfer->file_size)->toBe(filesize($transfer->file_path))
        ->and($transfer->expires_at->isFuture())->toBeTrue()
        ->and($transfer->expires_at->diffInHours(now(), true))->toBeGreaterThan(23.0)
        ->and($transfer->rows_total)->toBeGreaterThan(0)
        ->and($transfer->warnings)->toBe([]);

    $show = $this->actingAs($this->user)->getJson("{$this->base}/{$id}")->assertOk()->json();
    expect($show['downloadable'])->toBeTrue()->and($show['status'])->toBe('done');

    $response = $this->actingAs($this->user)->get("{$this->base}/{$id}/download")->assertOk();
    expect($response->headers->get('Content-Type'))->toBe('application/gzip')
        ->and($response->headers->get('Content-Disposition'))->toContain($transfer->file_name);

    $sql = gzdecode(sentBytes($response));
    expect($sql)->toStartWith('-- DBZuper dump')
        ->toContain('-- Method: built-in')
        ->toContain('-- App version: '.config('dbzuper.version'))
        ->toContain('-- Database: '.basename($this->path))
        ->not->toContain(dirname($this->path))
        ->toContain('CREATE TABLE');
    expect(substr_count($sql, '-- DBZuper dump'))->toBe(1);
});

it('serves a plain .sql file as application/sql', function () {
    $id = startExport(['gzip' => false])->json('id');
    runExport($id);

    $response = $this->actingAs($this->user)->get("{$this->base}/{$id}/download")->assertOk();

    expect($response->headers->get('Content-Type'))->toStartWith('application/sql')
        ->and(sentBytes($response))->toContain('CREATE TABLE');
});

it('resumes a download with Range', function () {
    $id = startExport()->json('id');
    $transfer = runExport($id);
    $bytes = file_get_contents($transfer->file_path);

    $response = $this->actingAs($this->user)->get("{$this->base}/{$id}/download", ['Range' => 'bytes=10-']);

    $response->assertStatus(206);
    expect((int) $response->headers->get('Content-Length'))->toBe(strlen($bytes) - 10)
        ->and(sentBytes($response))->toBe(substr($bytes, 10));
});

it('lists this user\'s transfers for the database, newest first, at most 10', function () {
    $other = SavedConnection::factory()->for($this->user)->create(['driver' => DriverName::Sqlite, 'database' => $this->path, 'host' => null, 'port' => null, 'username' => null, 'password' => null]);
    $make = fn (SavedConnection $c, ?int $userId = null) => Transfer::create([
        'user_id' => $userId ?? $this->user->id, 'saved_connection_id' => $c->id, 'database' => '',
        'direction' => TransferDirection::Export, 'method' => TransferMethod::Builtin, 'options' => [],
        'status' => TransferStatus::Done, 'file_name' => 'x.sql', 'finished_at' => now(),
    ]);
    $ids = [];
    for ($i = 0; $i < 12; $i++) {
        $this->travel(1)->seconds();
        $ids[] = $make($this->connection)->id;
    }
    $make($other);
    $make($this->connection, User::factory()->create()->id);

    $list = $this->actingAs($this->user)->getJson($this->base)->assertOk()->json('transfers');

    expect(array_column($list, 'id'))->toBe(array_slice(array_reverse($ids), 0, 10));
});

it('hides other users\' transfers', function () {
    $stranger = User::factory()->create();
    $theirs = Transfer::create([
        'user_id' => $stranger->id, 'saved_connection_id' => $this->connection->id, 'database' => '',
        'direction' => TransferDirection::Export, 'method' => TransferMethod::Builtin, 'options' => [],
        'status' => TransferStatus::Done, 'file_name' => 'x.sql', 'finished_at' => now(),
    ]);

    $this->actingAs($this->user)->getJson("{$this->base}/{$theirs->id}")->assertNotFound();
    $this->actingAs($this->user)->get("{$this->base}/{$theirs->id}/download")->assertNotFound();
    $this->actingAs($this->user)->postJson("{$this->base}/{$theirs->id}/cancel")->assertNotFound();
    expect($theirs->fresh()->cancel_requested_at)->toBeNull();

    // Mine, but asked for through another connection.
    $id = startExport()->assertAccepted()->json('id');
    $other = SavedConnection::factory()->for($this->user)->create(['driver' => DriverName::Sqlite, 'database' => $this->path, 'host' => null, 'port' => null, 'username' => null, 'password' => null]);
    $this->actingAs($this->user)->getJson("/api/c/{$other->id}/transfers/{$id}")->assertNotFound();

    // Someone else using my connection's URL.
    $this->actingAs($stranger)->getJson("{$this->base}/{$id}")->assertForbidden();
    $this->actingAs($this->user)->getJson("{$this->base}/not-a-uuid")->assertNotFound();
});

it('refuses a second backup of the same database', function () {
    startExport()->assertAccepted();

    startExport()->assertStatus(409)->assertExactJson(['message' => 'A backup of this database is already running']);
    expect(Transfer::query()->count())->toBe(1);
});

it('records one history entry', function () {
    $id = startExport()->json('id');
    runExport($id);

    $entries = $this->connection->history()->get();
    expect($entries)->toHaveCount(1)
        ->and($entries[0]->kind)->toBe('transfer')
        ->and($entries[0]->status)->toBe('ok')
        ->and($entries[0]->sql)->toMatch('/^-- Backup: \d+ tables, [\d.]+ (B|KB|MB), built-in$/');
});

it('records no history when store_history is off', function () {
    $this->connection->update(['store_history' => false]);
    $id = startExport()->json('id');

    expect(runExport($id)->status)->toBe(TransferStatus::Done)
        ->and($this->connection->history()->count())->toBe(0);
});

it('cancels a pending export', function () {
    $id = startExport()->json('id');

    $json = $this->actingAs($this->user)->postJson("{$this->base}/{$id}/cancel")->assertOk()->json();
    expect($json['status'])->toBe('cancelled')->and($json['cancel_requested_at'])->not->toBeNull();

    $transfer = runExport($id);
    expect($transfer->status)->toBe(TransferStatus::Cancelled)
        ->and($transfer->file_path)->toBeNull();
    $this->actingAs($this->user)->get("{$this->base}/{$id}/download")->assertNotFound();
});

it('asks a running export to stop', function () {
    $id = startExport()->json('id');
    Transfer::query()->whereKey($id)->update(['status' => TransferStatus::Running]);

    $json = $this->actingAs($this->user)->postJson("{$this->base}/{$id}/cancel")->assertOk()->json();

    expect($json['status'])->toBe('running')->and($json['cancel_requested_at'])->not->toBeNull();
});

it('deletes the partial file when the export fails', function () {
    app()->instance(BuiltinExporters::class, new BuiltinExporters(['sqlite' => ThrowingExporter::class]));
    ThrowingExporter::$error = null;
    $id = startExport()->json('id');

    $transfer = runExport($id);

    expect($transfer->status)->toBe(TransferStatus::Failed)
        ->and($transfer->error)->toBe('boom')
        ->and($transfer->file_path)->toBeNull()
        ->and(is_dir(storage_path('app/private/transfers/'.$id)))->toBeFalse();
    $entry = $this->connection->history()->sole();
    expect($entry->status)->toBe('error')->and($entry->error)->toBe('boom');
    $this->actingAs($this->user)->get("{$this->base}/{$id}/download")->assertNotFound();
});

it('explains row-level security errors', function () {
    app()->instance(BuiltinExporters::class, new BuiltinExporters(['sqlite' => ThrowingExporter::class]));
    ThrowingExporter::$error = new PDOException('SQLSTATE[42501]: query would be affected by row-level security policy for table "secrets"');
    $id = startExport()->json('id');

    expect(runExport($id)->error)->toBe("A table has row-level security that this login can't bypass. Connect as the table owner or a role with BYPASSRLS.");
    ThrowingExporter::$error = null;
});

it('does not download an expired export', function () {
    $id = startExport()->json('id');
    runExport($id);
    $this->travel(25)->hours();

    $this->actingAs($this->user)->get("{$this->base}/{$id}/download")->assertNotFound();
});

it('fails a native backup whose tool is no longer usable instead of switching methods', function () {
    $transfer = Transfer::create([
        'user_id' => $this->user->id, 'saved_connection_id' => $this->connection->id, 'database' => '',
        'direction' => TransferDirection::Export, 'method' => TransferMethod::Native,
        'options' => ['tables' => 'all', 'structure' => true, 'data' => true, 'drop' => false, 'gzip' => false],
        'status' => TransferStatus::Pending, 'file_name' => 'x.sql',
    ]);

    $done = runExport($transfer->id);

    expect($done->status)->toBe(TransferStatus::Failed)
        ->and($done->error)->toBe('The native backup tool can no longer be used: SQLite always uses the built-in method')
        ->and($done->file_path)->toBeNull()
        ->and(is_dir(storage_path('app/private/transfers/'.$transfer->id)))->toBeFalse();
});

it('fails the backup when the job cannot be queued', function () {
    Bus::shouldReceive('dispatch')->once()->andThrow(new RuntimeException('queue down'));

    startExport()->assertStatus(503)->assertJson(['message' => "Couldn't queue the job: queue down"]);

    $transfer = Transfer::query()->sole();
    expect($transfer->status)->toBe(TransferStatus::Failed)
        ->and($transfer->error)->toBe("Couldn't queue the job: queue down")
        ->and($transfer->finished_at)->not->toBeNull();
});

it('fails a backup whose connection was changed after it started', function () {
    $id = startExport()->json('id');
    $other = Engines::sqlitePath().'-other.sqlite';
    touch($other);
    $this->connection->update(['database' => $other]);

    $transfer = runExport($id);

    expect($transfer->status)->toBe(TransferStatus::Failed)
        ->and($transfer->error)->toBe('The connection was changed after this backup started. Start the backup again.')
        ->and($transfer->file_path)->toBeNull();
    @unlink($other);
});

it('says on each transfer whether a worker is alive', function () {
    $id = startExport()->assertAccepted()->json('id');

    $this->actingAs($this->user)->getJson("{$this->base}/{$id}")->assertOk()->assertJsonPath('worker_alive', false);
    WorkerHeartbeat::beat();
    $this->actingAs($this->user)->getJson("{$this->base}/{$id}")->assertOk()->assertJsonPath('worker_alive', true);
});

it('caps a backup at 10,000 named tables', function () {
    $keys = array_map(fn (int $i) => "t{$i}", range(1, 10_001));

    startExport(['tables' => $keys])->assertUnprocessable()
        ->assertJsonPath('errors.tables.0', 'Choose at most 10,000 tables, or back up all of them');
});
