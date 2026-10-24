<?php

use App\Database\Schema\SnapshotService;
use App\Database\Schema\SnapshotSummary;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Models\StoredSnapshot;
use App\Models\User;
use App\Support\Demo\CommerceSchema;
use Illuminate\Support\Facades\DB;
use Tests\Support\Engines;

function summaryTable(string $name, string $kind = 'table'): array
{
    return ['name' => $name, 'kind' => $kind, 'primary_key' => [], 'columns' => [], 'indexes' => []];
}

function summaryRelation(string $from, string $to, bool $inferred = false): array
{
    return ['id' => "fk:{$from}->{$to}", 'from_table' => $from, 'from_columns' => ['x'], 'to_table' => $to, 'to_columns' => ['id'], 'inferred' => $inferred, 'confidence' => 1.0, 'name' => null];
}

it('counts tables and views and keeps only declared foreign keys as edges', function () {
    $summary = SnapshotSummary::of([
        'tables' => [summaryTable('orders'), summaryTable('users'), summaryTable('products'), summaryTable('sales', 'view')],
        'relationships' => [summaryRelation('orders', 'users'), summaryRelation('orders', 'products', inferred: true)],
    ]);

    expect($summary['table_count'])->toBe(3)
        ->and($summary['view_count'])->toBe(1)
        ->and($summary['preview']['edges'])->toHaveCount(1);

    [$from, $to] = $summary['preview']['edges'][0];
    expect([$summary['preview']['nodes'][$from], $summary['preview']['nodes'][$to]])->toBe(['orders', 'users']);
});

it('samples at most 80 nodes, most connected first, then alphabetically', function () {
    $tables = array_map(fn ($i) => summaryTable(sprintf('t%03d', $i)), range(1, 100));
    $relations = [
        summaryRelation('t050', 't099'), summaryRelation('t051', 't099'), summaryRelation('t052', 't099'),
        summaryRelation('t050', 't098'),
        summaryRelation('t001', 't002', inferred: true), summaryRelation('t001', 't003', inferred: true),
        summaryRelation('t001', 't004', inferred: true), summaryRelation('t001', 't005', inferred: true),
    ];

    $preview = SnapshotSummary::of(['tables' => $tables, 'relationships' => $relations])['preview'];

    expect($preview['nodes'])->toHaveCount(80)
        ->and($preview['nodes'][0])->toBe('t099')
        ->and($preview['nodes'][1])->toBe('t050')
        ->and(array_slice($preview['nodes'], 2, 4))->toBe(['t051', 't052', 't098', 't001'])
        ->and($preview['edges'])->toHaveCount(4);

    foreach ($preview['edges'] as [$from, $to]) {
        expect($from)->toBeLessThan(80)->and($to)->toBeLessThan(80);
    }
});

it('drops edges whose ends fall outside the sample and ignores views as nodes', function () {
    $preview = SnapshotSummary::of([
        'tables' => [summaryTable('a'), summaryTable('v', 'view')],
        'relationships' => [summaryRelation('a', 'missing')],
    ])['preview'];

    expect($preview)->toBe(['nodes' => ['a'], 'edges' => []]);
});

describe('stored snapshots', function () {
    beforeEach(function () {
        $this->user = User::factory()->create();
        $path = Engines::sqlitePath();
        $db = DB::connectUsing('fixture', ['driver' => 'sqlite', 'database' => $path, 'prefix' => '', 'foreign_key_constraints' => true], force: true);
        CommerceSchema::create($db);
        DB::purge('fixture');

        $this->connection = SavedConnection::factory()->for($this->user)->create([
            'driver' => DriverName::Sqlite, 'host' => null, 'port' => null, 'database' => $path, 'username' => null, 'password' => null,
        ]);
    });

    afterEach(fn () => Engines::resetSqlite());

    it('stores counts and a preview on refresh', function () {
        $stored = app(SnapshotService::class)->refresh($this->connection)->fresh();

        expect($stored->table_count)->toBeGreaterThan(0)
            ->and($stored->view_count)->not->toBeNull()
            ->and($stored->preview['nodes'])->toContain('users')
            ->and($stored->preview['edges'])->not->toBeEmpty();
    });

    it('backfills the latest snapshot of each connection from its payload', function () {
        $payload = ['tables' => [summaryTable('a'), summaryTable('b'), summaryTable('v', 'view')], 'relationships' => [summaryRelation('a', 'b')]];
        $old = StoredSnapshot::create(['connection_id' => $this->connection->id, 'hash' => str_repeat('a', 40), 'payload' => $payload]);
        $latest = StoredSnapshot::create(['connection_id' => $this->connection->id, 'hash' => str_repeat('b', 40), 'payload' => $payload]);
        $other = SavedConnection::factory()->for($this->user)->create();
        $otherLatest = StoredSnapshot::create(['connection_id' => $other->id, 'hash' => str_repeat('c', 40), 'payload' => $payload]);

        $migration = require database_path('migrations/2026_10_25_000002_add_summary_to_schema_snapshots.php');
        $migration::backfill();

        expect($latest->fresh()->table_count)->toBe(2)
            ->and($latest->fresh()->view_count)->toBe(1)
            ->and($latest->fresh()->preview)->toBe(['nodes' => ['a', 'b'], 'edges' => [[0, 1]]])
            ->and($otherLatest->fresh()->table_count)->toBe(2)
            ->and($old->fresh()->table_count)->toBeNull();
    });
});
