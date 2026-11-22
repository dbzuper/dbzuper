<?php

use App\Database\Schema\SnapshotService;
use App\Enums\DriverName;
use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Enums\TransferStatus;
use App\Jobs\RunExport;
use App\Jobs\RunImport;
use App\Models\SavedConnection;
use App\Models\Transfer;
use App\Models\User;
use App\Support\Demo\CommerceSchema;
use App\Transfers\DiskSpace;
use App\Transfers\Import\RestoreFailed;
use App\Transfers\TransferStorage;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;
use Tests\Support\Engines;

beforeEach(function () {
    $this->user = User::factory()->create();

    // The demo database, the source of the end-to-end round trip.
    $source = Engines::sqlitePath();
    $db = DB::connectUsing('fixture', ['driver' => 'sqlite', 'database' => $source, 'prefix' => '', 'foreign_key_constraints' => true], force: true);
    CommerceSchema::create($db);
    DB::purge('fixture');
    $this->source = SavedConnection::factory()->for($this->user)->create([
        'driver' => DriverName::Sqlite, 'host' => null, 'port' => null, 'database' => $source, 'username' => null, 'password' => null,
    ]);

    // An empty second SQLite file: every restore goes here.
    $this->target = Engines::prepareRestoreTarget('sqlite');
    $this->target->user_id = $this->user->id;
    $this->target->save();
    $this->targetName = basename((string) $this->target->database);
    $this->base = "/api/c/{$this->target->id}/transfers";
    Queue::fake();
});

afterEach(function () {
    foreach (Transfer::query()->get() as $t) {
        TransferStorage::deleteFiles($t);
    }
    Engines::dropRestoreTarget('sqlite');
    Engines::resetSqlite();
});

function importStart(array $body = []): TestResponse
{
    return test()->actingAs(test()->user)->postJson(test()->base.'/import', $body + [
        'file_name' => 'shop-20261122-101500.sql.gz', 'size' => 10, 'confirm' => test()->targetName,
    ]);
}

function importChunk(string $id, int|string|null $offset, string $bytes): TestResponse
{
    $server = ['CONTENT_TYPE' => 'application/octet-stream', 'HTTP_ACCEPT' => 'application/json'];
    if ($offset !== null) {
        $server['HTTP_UPLOAD_OFFSET'] = (string) $offset;
    }

    return test()->actingAs(test()->user)->call('PUT', test()->base."/{$id}/upload", [], [], [], $server, $bytes);
}

/** Uploads the bytes in $chunkSize pieces and returns the last response. */
function importUpload(string $id, string $bytes, int $chunkSize): TestResponse
{
    $response = null;
    foreach (str_split($bytes, max(1, $chunkSize)) as $i => $piece) {
        $response = importChunk($id, $i * $chunkSize, $piece)->assertOk();
    }

    return $response;
}

function importRun(string $id): Transfer
{
    (new RunImport($id))->handle();

    return Transfer::query()->findOrFail($id);
}

function uploadDir(string $id): string
{
    return storage_path('app/private/transfers/'.$id);
}

/** @return array<string, int> table => rows, for a SQLite file */
function sqliteTableCounts(string $path): array
{
    $pdo = new PDO('sqlite:'.$path);
    $counts = [];
    foreach ($pdo->query("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")->fetchAll(PDO::FETCH_COLUMN) as $table) {
        $counts[$table] = (int) $pdo->query('select count(*) from "'.str_replace('"', '""', $table).'"')->fetchColumn();
    }

    return $counts;
}

it('requires the typed database name', function () {
    importStart(['confirm' => 'something else'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['confirm' => "Type {$this->targetName} to confirm"]);
    importStart(['confirm' => strtoupper($this->targetName)])->assertUnprocessable()->assertJsonValidationErrors('confirm');
    importStart(['confirm' => ''])->assertUnprocessable()->assertJsonValidationErrors('confirm');

    expect(Transfer::query()->count())->toBe(0);
});

it('refuses read-only connections', function () {
    $this->target->update(['read_only' => true]);

    importStart()->assertForbidden()->assertJson(['message' => 'This connection is read-only.']);

    expect(Transfer::query()->count())->toBe(0);
});

it('enforces the size cap', function () {
    config(['dbzuper.transfer_max_bytes' => 2048]);

    importStart(['size' => 2049])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['size' => 'The file is larger than the limit of 2 KB']);
    importStart(['size' => 0])->assertUnprocessable()->assertJsonValidationErrors('size');
    importStart(['file_name' => ''])->assertUnprocessable()->assertJsonValidationErrors('file_name');
    importStart(['method' => 'native'])->assertUnprocessable();
    expect(Transfer::query()->count())->toBe(0);

    importStart(['size' => 2048])->assertCreated();
});

it('starts an upload', function () {
    $json = importStart(['size' => 30])->assertCreated()->json();

    expect($json['status'])->toBe('uploading')
        ->and($json['direction'])->toBe('import')
        ->and($json['method'])->toBe('builtin')
        ->and($json['bytes_total'])->toBe(30)
        ->and($json['file_name'])->toBe('shop-20261122-101500.sql.gz')
        ->and($json)->not->toHaveKey('file_path');

    $transfer = Transfer::query()->findOrFail($json['id']);
    expect($transfer->file_path)->toStartWith(uploadDir($json['id']))
        ->and($transfer->options['method_reason'])->toBe('SQLite always uses the built-in method');
    Queue::assertNothingPushed();
});

it('keeps only the file name the browser sent', function () {
    $json = importStart(['file_name' => "C:\\Users\\me\\dumps\\..\\sh\x01op.sql"])->assertCreated()->json();

    expect($json['file_name'])->toBe('sh_op.sql');
});

it('refuses a second transfer of the same database', function () {
    importStart()->assertCreated();

    importStart()->assertStatus(409)->assertExactJson(['message' => 'A restore of this database is already running']);
});

it('assembles chunks and starts the restore when complete', function () {
    $bytes = random_bytes(25);
    $id = importStart(['size' => 25])->json('id');

    importChunk($id, 0, substr($bytes, 0, 10))->assertOk()->assertJson(['offset' => 10]);
    expect(Transfer::query()->findOrFail($id)->status)->toBe(TransferStatus::Uploading)
        ->and(Transfer::query()->findOrFail($id)->bytes_done)->toBe(10);
    importChunk($id, 10, substr($bytes, 10, 10))->assertOk()->assertJson(['offset' => 20]);
    Queue::assertNothingPushed();

    importChunk($id, 20, substr($bytes, 20))->assertOk()->assertJson(['offset' => 25, 'status' => 'pending']);

    $transfer = Transfer::query()->findOrFail($id);
    expect($transfer->status)->toBe(TransferStatus::Pending)
        ->and($transfer->bytes_done)->toBe(0)
        ->and(file_get_contents($transfer->file_path))->toBe($bytes);
    Queue::assertPushed(RunImport::class, fn (RunImport $job) => $job->transferId === $id
        && $job->connection === 'transfers' && $job->queue === 'transfers');
    Queue::assertPushed(RunImport::class, 1);

    // Complete: no more bytes are taken.
    importChunk($id, 25, 'x')->assertStatus(409)
        ->assertExactJson(['message' => 'This upload is no longer accepting data.', 'status' => 'pending', 'offset' => 25]);
    // A retried last chunk: the client reads status pending + offset = size as success.
    importChunk($id, 20, substr($bytes, 20))->assertStatus(409)->assertJson(['status' => 'pending', 'offset' => 25]);
    Queue::assertPushed(RunImport::class, 1);
});

it('answers a wrong offset with the current offset', function () {
    $id = importStart(['size' => 30])->json('id');
    importChunk($id, 0, str_repeat('a', 10))->assertOk();

    // A retry of the first chunk after a dropped connection, and a chunk that skips ahead.
    importChunk($id, 0, str_repeat('a', 10))->assertStatus(409)
        ->assertExactJson(['message' => 'The upload is at byte 10.', 'status' => 'uploading', 'offset' => 10]);
    importChunk($id, 20, str_repeat('c', 10))->assertStatus(409)->assertJson(['status' => 'uploading', 'offset' => 10]);

    importChunk($id, 10, str_repeat('b', 10))->assertOk()->assertJson(['offset' => 20]);
    expect(file_get_contents(Transfer::query()->findOrFail($id)->file_path))->toBe(str_repeat('a', 10).str_repeat('b', 10));
});

it('rejects a missing or malformed offset', function () {
    $id = importStart()->json('id');

    importChunk($id, null, 'abc')->assertUnprocessable();
    importChunk($id, '-1', 'abc')->assertUnprocessable();
    importChunk($id, '1e3', 'abc')->assertUnprocessable();
    expect(is_file((string) Transfer::query()->findOrFail($id)->file_path) ? filesize(Transfer::query()->findOrFail($id)->file_path) : 0)->toBe(0);
});

it('rejects a chunk larger than 8 MB', function () {
    $id = importStart(['size' => 9 * 1024 * 1024])->json('id');

    importChunk($id, 0, str_repeat('x', 8 * 1024 * 1024 + 1))->assertStatus(413);
    importChunk($id, 0, 'abc')->assertOk()->assertJson(['offset' => 3]);
});

it('rejects bytes past the size given at the start', function () {
    $id = importStart(['size' => 10])->json('id');

    importChunk($id, 0, str_repeat('x', 11))->assertUnprocessable();
    importChunk($id, 0, str_repeat('x', 10))->assertOk()->assertJson(['offset' => 10, 'status' => 'pending']);
});

it('rejects a chunk after the upload was abandoned', function () {
    $id = importStart(['size' => 30])->json('id');
    importChunk($id, 0, str_repeat('a', 10))->assertOk();
    Transfer::query()->whereKey($id)->update(['updated_at' => now()->subHours((int) config('dbzuper.transfer_ttl_hours') + 1)]);
    TransferStorage::prune();

    importChunk($id, 10, str_repeat('b', 10))->assertStatus(409)
        ->assertExactJson(['message' => 'This upload is no longer accepting data.', 'status' => 'failed']);

    expect(is_dir(uploadDir($id)))->toBeFalse()
        ->and(Transfer::query()->findOrFail($id)->error)->toBe('Upload abandoned');
});

it('keeps an active upload from looking abandoned', function () {
    $id = importStart(['size' => 30])->json('id');
    $this->travel((int) config('dbzuper.transfer_ttl_hours') - 1)->hours();
    importChunk($id, 0, str_repeat('a', 10))->assertOk();
    $this->travel(2)->hours();

    TransferStorage::prune();

    expect(Transfer::query()->findOrFail($id)->status)->toBe(TransferStatus::Uploading);
});

it('cancels an upload at once and deletes the partial file', function () {
    $id = importStart(['size' => 30])->json('id');
    importChunk($id, 0, str_repeat('a', 10))->assertOk();

    $json = $this->actingAs($this->user)->postJson("{$this->base}/{$id}/cancel")->assertOk()->json();

    expect($json['status'])->toBe('cancelled')
        ->and(is_dir(uploadDir($id)))->toBeFalse()
        ->and(Transfer::query()->findOrFail($id)->file_path)->toBeNull();
    importChunk($id, 10, str_repeat('b', 10))->assertStatus(409);
    expect(is_dir(uploadDir($id)))->toBeFalse();
});

it('cancels a queued restore and deletes the upload', function () {
    $id = importStart(['size' => 3])->json('id');
    importChunk($id, 0, 'abc')->assertOk();

    $this->actingAs($this->user)->postJson("{$this->base}/{$id}/cancel")->assertOk()->assertJson(['status' => 'cancelled']);

    expect(is_dir(uploadDir($id)))->toBeFalse()
        ->and(importRun($id)->status)->toBe(TransferStatus::Cancelled);
});

it('hides other users\' uploads', function () {
    $id = importStart()->json('id');
    $stranger = User::factory()->create();

    $this->actingAs($stranger)->call('PUT', "{$this->base}/{$id}/upload", [], [], [], ['HTTP_UPLOAD_OFFSET' => '0', 'HTTP_ACCEPT' => 'application/json'], 'abc')->assertForbidden();
    $other = SavedConnection::factory()->for($this->user)->create(['driver' => DriverName::Sqlite, 'database' => $this->target->database, 'host' => null, 'port' => null, 'username' => null, 'password' => null]);
    $this->actingAs($this->user)->call('PUT', "/api/c/{$other->id}/transfers/{$id}/upload", [], [], [], ['HTTP_UPLOAD_OFFSET' => '0', 'HTTP_ACCEPT' => 'application/json'], 'abc')->assertNotFound();
});

it('fails the restore when the job cannot be queued', function () {
    $id = importStart(['size' => 3])->json('id');
    Bus::shouldReceive('dispatch')->once()->andThrow(new RuntimeException('queue down'));

    importChunk($id, 0, 'abc')->assertStatus(503)->assertJson(['message' => "Couldn't queue the job: queue down"]);

    $transfer = Transfer::query()->findOrFail($id);
    expect($transfer->status)->toBe(TransferStatus::Failed)
        ->and($transfer->error)->toBe("Couldn't queue the job: queue down")
        ->and($transfer->finished_at)->not->toBeNull()
        ->and(is_dir(uploadDir($id)))->toBeFalse();
    // The database is free again.
    importStart()->assertCreated();
});

it('restores a gzip upload end to end', function () {
    // A gzip backup of the demo database, made by the export job.
    $export = $this->actingAs($this->user)->postJson("/api/c/{$this->source->id}/transfers/export", [
        'tables' => 'all', 'structure' => true, 'data' => true, 'drop' => false, 'gzip' => true,
    ])->assertAccepted()->json('id');
    (new RunExport($export))->handle();
    $dump = file_get_contents(Transfer::query()->findOrFail($export)->file_path);
    expect(substr($dump, 0, 2))->toBe("\x1f\x8b");

    $id = importStart(['file_name' => 'demo.sql.gz', 'size' => strlen($dump)])->assertCreated()->json('id');
    importUpload($id, $dump, max(1, intdiv(strlen($dump), 3) + 1))->assertJson(['status' => 'pending']);
    expect($this->target->snapshots()->count())->toBe(0);

    $transfer = importRun($id);

    expect($transfer->status)->toBe(TransferStatus::Done)
        ->and($transfer->error)->toBeNull()
        ->and($transfer->statements_done)->toBeGreaterThan(0)
        ->and($transfer->bytes_done)->toBe(strlen($dump))
        ->and($transfer->file_path)->toBeNull()
        ->and(is_dir(uploadDir($id)))->toBeFalse();

    $expected = sqliteTableCounts((string) $this->source->database);
    expect($expected)->not->toBeEmpty()
        ->and(sqliteTableCounts((string) $this->target->database))->toBe($expected);

    $snapshot = $this->target->snapshots()->latest('id')->first();
    expect($snapshot)->not->toBeNull()
        ->and(collect($snapshot->payload['tables'])->where('kind', 'table')->pluck('name')->sort()->values()->all())
        ->toBe(collect(array_keys($expected))->sort()->values()->all());

    $entry = $this->target->history()->sole();
    expect($entry->kind)->toBe('transfer')->and($entry->status)->toBe('ok')
        ->and($entry->sql)->toMatch('/^-- Restore: demo\.sql\.gz, [\d,]+ statements, built-in$/');
});

it('reports the failing statement and that nothing changed', function () {
    $sql = "CREATE TABLE kept (id integer primary key);\nINSERT INTO kept VALUES (1);\nINSERT INTO missing_table VALUES (1);\n";
    $id = importStart(['file_name' => 'bad.sql', 'size' => strlen($sql)])->json('id');
    importChunk($id, 0, $sql)->assertOk();

    $transfer = importRun($id);

    expect($transfer->status)->toBe(TransferStatus::Failed)
        ->and($transfer->error)->toStartWith('Statement 3 failed: ')
        ->and($transfer->error)->toContain('missing_table')
        ->and($transfer->error)->toContain("\nINSERT INTO missing_table VALUES (1)\n")
        ->and($transfer->error)->toEndWith("\nNothing was changed.")
        ->and($transfer->file_path)->toBeNull()
        ->and(is_dir(uploadDir($id)))->toBeFalse()
        ->and(sqliteTableCounts((string) $this->target->database))->toBe([]);

    $entry = $this->target->history()->sole();
    expect($entry->status)->toBe('error')->and($entry->error)->toBe($transfer->error);
});

it('says when the restore failed after its last statement', function () {
    // A row that breaks a foreign key: caught by the closing check, not by a statement.
    $sql = "CREATE TABLE parent (id integer primary key);\nCREATE TABLE child (id integer primary key, parent_id integer references parent(id));\nINSERT INTO child VALUES (1, 99);\n";
    $id = importStart(['file_name' => 'fk.sql', 'size' => strlen($sql)])->json('id');
    importChunk($id, 0, $sql)->assertOk();

    $transfer = importRun($id);

    expect($transfer->status)->toBe(TransferStatus::Failed)
        ->and($transfer->error)->toStartWith('The restore failed at the end: Foreign key check failed')
        ->and($transfer->error)->toEndWith("\nNothing was changed.")
        ->and(sqliteTableCounts((string) $this->target->database))->toBe([]);
});

it('fails a native restore whose tool is no longer usable instead of switching methods', function () {
    $transfer = Transfer::create([
        'user_id' => $this->user->id, 'saved_connection_id' => $this->target->id, 'database' => '',
        'direction' => TransferDirection::Import, 'method' => TransferMethod::Native, 'options' => [],
        'status' => TransferStatus::Pending, 'file_name' => 'x.sql', 'bytes_total' => 3,
    ]);
    $path = TransferStorage::directory($transfer).DIRECTORY_SEPARATOR.'upload';
    file_put_contents($path, 'SELECT 1;');
    $transfer->forceFill(['file_path' => $path])->save();

    $done = importRun($transfer->id);

    expect($done->status)->toBe(TransferStatus::Failed)
        ->and($done->error)->toBe('The native restore tool can no longer be used: SQLite always uses the built-in method')
        ->and(is_dir(uploadDir($transfer->id)))->toBeFalse();
});

it('does not fail the restore when the snapshot refresh fails', function () {
    $sql = "CREATE TABLE t (id integer);\n";
    $id = importStart(['file_name' => 'ok.sql', 'size' => strlen($sql)])->json('id');
    importChunk($id, 0, $sql)->assertOk();
    // SnapshotService is final: a stand-in whose refresh throws.
    app()->instance(SnapshotService::class, new class
    {
        public function refresh(): never
        {
            throw new RuntimeException('inspector broke');
        }
    });

    $transfer = importRun($id);

    expect($transfer->status)->toBe(TransferStatus::Done)
        ->and($this->target->history()->sole()->status)->toBe('ok')
        ->and(sqliteTableCounts((string) $this->target->database))->toBe(['t' => 0]);
});

it('prunes from the list at most once a minute', function () {
    $ttl = (int) config('dbzuper.transfer_ttl_hours');
    $abandon = function () use ($ttl): string {
        $t = Transfer::create([
            'user_id' => $this->user->id, 'saved_connection_id' => $this->source->id, 'database' => '',
            'direction' => TransferDirection::Import, 'method' => TransferMethod::Builtin, 'options' => [],
            'status' => TransferStatus::Uploading, 'file_name' => 'x.sql', 'bytes_total' => 10,
        ]);
        Transfer::query()->whereKey($t->id)->update(['updated_at' => now()->subHours($ttl + 1)]);

        return $t->id;
    };

    $first = $abandon();
    $this->actingAs($this->user)->getJson($this->base)->assertOk();
    expect(Transfer::query()->findOrFail($first)->status)->toBe(TransferStatus::Failed);

    // The same database can hold only one active transfer, so the next abandoned upload replaces the first.
    Transfer::query()->whereKey($first)->delete();
    $second = $abandon();
    $this->actingAs($this->user)->getJson($this->base)->assertOk();
    expect(Transfer::query()->findOrFail($second)->status)->toBe(TransferStatus::Uploading);

    $this->travel(61)->seconds();
    $this->actingAs($this->user)->getJson($this->base)->assertOk();
    expect(Transfer::query()->findOrFail($second)->status)->toBe(TransferStatus::Failed);
});

it('refuses a chunk whose Content-Length is over 8 MB before reading it', function () {
    $id = importStart(['size' => 9 * 1024 * 1024])->json('id');

    $this->actingAs($this->user)->call('PUT', "{$this->base}/{$id}/upload", [], [], [], [
        'HTTP_UPLOAD_OFFSET' => '0', 'HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => 'application/octet-stream',
        'CONTENT_LENGTH' => (string) (8 * 1024 * 1024 + 1),
    ], 'abc')->assertStatus(413);
});

it('describes a failed statement for each engine', function () {
    $failed = new RestoreFailed(7, 'INSERT INTO t VALUES (1)', "Duplicate entry '1'");

    expect(RunImport::describe($failed, DriverName::MySql, TransferMethod::Builtin))
        ->toBe("Statement 7 failed: Duplicate entry '1'\nINSERT INTO t VALUES (1)\nStatements before it were applied.")
        ->and(RunImport::describe($failed, DriverName::MariaDb, TransferMethod::Native))->toEndWith("\nStatements before it were applied.")
        ->and(RunImport::describe($failed, DriverName::Postgres, TransferMethod::Builtin))->toEndWith(")\nNothing was changed.");

    $atEnd = new RestoreFailed(0, '', 'deferred constraint violated');
    expect(RunImport::describe($atEnd, DriverName::Postgres, TransferMethod::Builtin))
        ->toBe("The restore failed at the end: deferred constraint violated\nNothing was changed.")
        ->and(RunImport::describe(new RestoreFailed(0, '', 'ERROR 1146 at line 12: no table'), DriverName::MySql, TransferMethod::Native))
        ->toBe("ERROR 1146 at line 12: no table\nStatements before it were applied.");
});

it('takes upload chunks only as raw bytes', function () {
    $id = importStart(['size' => 6])->json('id');
    $put = fn (string $type) => $this->actingAs($this->user)->call('PUT', "{$this->base}/{$id}/upload", [], [], [], [
        'HTTP_UPLOAD_OFFSET' => '0', 'HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => $type,
    ], 'a=b&c');

    $put('application/x-www-form-urlencoded')->assertStatus(415);
    $put('application/json')->assertStatus(415);
    $put('multipart/form-data; boundary=x')->assertStatus(415);
    // No Content-Type at all (Symfony's test requests default to a form type, so it is blanked here).
    $put('')
        ->assertOk()->assertJson(['offset' => 5]);
    $put('Application/Octet-Stream; charset=binary')->assertStatus(409)->assertJson(['offset' => 5]);
});

it('refuses a file the disk has no room for', function () {
    $free = 5 * 1024 * 1024 * 1024;
    app()->instance(DiskSpace::class, new class($free) extends DiskSpace
    {
        public function __construct(private float $bytes) {}

        public function free(): ?float
        {
            return $this->bytes;
        }
    });

    importStart(['size' => $free - DiskSpace::MARGIN_BYTES + 1])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['size' => "There isn't enough free disk space for this file (5 GB free)"]);
    importStart(['size' => $free - DiskSpace::MARGIN_BYTES])->assertCreated();
});

it('skips the disk space check when the system cannot tell', function () {
    app()->instance(DiskSpace::class, new class extends DiskSpace
    {
        public function free(): ?float
        {
            return null;
        }
    });

    importStart(['size' => 10])->assertCreated();
});

it('fails the restore when the connection was changed after it started', function () {
    $sql = 'CREATE TABLE t (id integer);
';
    $id = importStart(['file_name' => 'ok.sql', 'size' => strlen($sql)])->json('id');
    importChunk($id, 0, $sql)->assertOk()->assertJson(['status' => 'pending']);

    // Pointed at the demo database between the upload and the job.
    $this->target->update(['database' => $this->source->database]);
    $before = sqliteTableCounts((string) $this->source->database);

    $transfer = importRun($id);

    expect($transfer->status)->toBe(TransferStatus::Failed)
        ->and($transfer->error)->toBe('The connection was changed after this restore started. Start the restore again.')
        ->and(is_dir(uploadDir($id)))->toBeFalse()
        ->and(sqliteTableCounts((string) $this->source->database))->toBe($before);
});

it('stores the confirmed target with the restore', function () {
    $id = importStart()->json('id');

    expect(Transfer::query()->findOrFail($id)->options['target'])->toBe([
        'driver' => 'sqlite', 'host' => null, 'port' => null, 'database' => realpath((string) $this->target->database),
    ]);
});

it('says the upload is gone without naming the server path', function () {
    $sql = 'CREATE TABLE t (id integer);
';
    $id = importStart(['file_name' => 'ok.sql', 'size' => strlen($sql)])->json('id');
    importChunk($id, 0, $sql)->assertOk();
    unlink(Transfer::query()->findOrFail($id)->file_path);

    $transfer = importRun($id);

    expect($transfer->status)->toBe(TransferStatus::Failed)
        ->and($transfer->error)->toBe('The uploaded file is no longer available. Upload it again.')
        ->and($transfer->error)->not->toContain(storage_path());
});
