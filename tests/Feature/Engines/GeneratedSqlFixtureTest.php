<?php

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Query\TableRowsQuery;
use App\Enums\DriverName;
use Illuminate\Database\Schema\Blueprint;
use Tests\Support\Engines;

/**
 * Records the SQL the server generates for table-tab filters/sort/paging, per engine, into a committed
 * fixture the frontend matcher is tested against. Regenerate with UPDATE_SQL_FIXTURES=1.
 */
const SQL_FIXTURE = __DIR__.'/../../../resources/js/browse/__fixtures__/generated-sql.json';

function sqlFixtureCases(): array
{
    $f = fn (string $column, string $op, ?string $value = null) => $value === null && in_array($op, ['is_null', 'is_not_null'], true)
        ? ['column' => $column, 'op' => $op]
        : ['column' => $column, 'op' => $op, 'value' => $value];
    $asc = fn (string $c) => ['column' => $c, 'direction' => 'asc'];
    $desc = fn (string $c) => ['column' => $c, 'direction' => 'desc'];

    return [
        [[$f('name', 'eq', "O'Brien")], [], 1, 50],
        [[$f('name', 'neq', 'a'.chr(92).'b')], [], 1, 50],
        [[$f('total', 'lt', '10.5')], [], 1, 50],
        [[$f('total', 'lte', '10.5')], [], 1, 50],
        [[$f('total', 'gt', '10.5')], [], 1, 50],
        [[$f('total', 'gte', '10.5')], [], 1, 50],
        [[$f('name', 'contains', '50%')], [], 1, 50],
        [[$f('name', 'starts_with', 'a_b')], [], 1, 50],
        [[$f('name', 'ends_with', 'x!y')], [], 1, 50],
        [[$f('note', 'is_null')], [], 1, 50],
        [[$f('note', 'is_not_null')], [], 1, 50],
        [[$f('name', 'eq', '数据')], [], 1, 50],
        [[$f('name', 'contains', 'ab'), $f('total', 'gt', '10.5')], [], 1, 50],
        [[], [$desc('name')], 1, 50],
        [[], [$asc('total'), $desc('name')], 1, 50],
        [[], [], 3, 50],
        [[], [], 1, 1000],
    ];
}

it('records the server-generated table SQL per engine for the matcher', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $factory = app(ConnectionFactory::class);
    $driver = app(DriverRegistry::class)->for(DriverName::from($engine));
    $db = $factory->make($saved);
    $schema = $db->getSchemaBuilder();

    try {
        $schema->dropIfExists('m7_sql_fixture');
        $schema->create('m7_sql_fixture', function (Blueprint $t) {
            $t->integer('id')->primary();
            $t->string('name');
            $t->text('note')->nullable();
            $t->decimal('total', 10, 2);
        });
        $table = [
            'name' => 'm7_sql_fixture',
            'columns' => [
                ['name' => 'id', 'type' => 'integer', 'type_name' => 'integer'],
                ['name' => 'name', 'type' => 'varchar(255)', 'type_name' => 'varchar'],
                ['name' => 'note', 'type' => 'text', 'type_name' => 'text'],
                ['name' => 'total', 'type' => 'decimal(10,2)', 'type_name' => 'decimal'],
            ],
            'indexes' => [['name' => 'PRIMARY', 'columns' => ['id'], 'primary' => true, 'unique' => true]],
        ];

        $cases = [];
        foreach (sqlFixtureCases() as [$filters, $sort, $page, $perPage]) {
            $cases[] = [
                'filters' => $filters,
                'sort' => $sort,
                'page' => $page,
                'perPage' => $perPage,
                'sql' => TableRowsQuery::run($db, $driver, $table, $filters, $sort, $page, $perPage)['sql'],
            ];
        }
    } finally {
        $schema->dropIfExists('m7_sql_fixture');
        $factory->release($db);
    }

    $all = is_file(SQL_FIXTURE) ? json_decode((string) file_get_contents(SQL_FIXTURE), true) : [];
    if (getenv('UPDATE_SQL_FIXTURES') === '1') {
        $all[$engine] = $cases;
        $order = array_flip(Engines::ENGINES);
        uksort($all, fn ($a, $b) => ($order[$a] ?? 99) <=> ($order[$b] ?? 99));
        file_put_contents(SQL_FIXTURE, json_encode($all, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)."\n");

        expect(true)->toBeTrue();

        return;
    }

    expect($all[$engine] ?? null)->toEqual($cases, "Generated {$engine} SQL differs from generated-sql.json. Re-run with UPDATE_SQL_FIXTURES=1 php artisan test --filter=GeneratedSqlFixture and review the diff.");
})->with(['sqlite', 'mysql', 'mariadb', 'pgsql']);
