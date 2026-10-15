<?php

use App\Database\ConnectionFactory;
use Illuminate\Database\Connection;
use Tests\Support\Engines;

it('pins string-parsing session modes, also after a reconnect', function (string $engine, string $sql, Closure $assert) {
    Engines::skipUnlessAvailable($engine);

    $values = app(ConnectionFactory::class)->using(Engines::savedConnection($engine), function (Connection $db) use ($sql) {
        $before = (string) array_values((array) $db->selectOne($sql))[0];
        $db->reconnect();

        return [$before, (string) array_values((array) $db->selectOne($sql))[0]];
    }, 7);

    foreach ($values as $value) {
        $assert($value);
    }
})->with([
    'mysql' => ['mysql', 'select @@session.sql_mode', fn (string $v) => expect($v)->not->toContain('NO_BACKSLASH_ESCAPES')->not->toContain('ANSI_QUOTES')],
    'mariadb' => ['mariadb', 'select @@session.sql_mode', fn (string $v) => expect($v)->not->toContain('NO_BACKSLASH_ESCAPES')->not->toContain('ANSI_QUOTES')],
    'pgsql' => ['pgsql', 'show standard_conforming_strings', fn (string $v) => expect($v)->toBe('on')],
]);

it('keeps the MySQL modes and the read-only guard together', function (string $engine) {
    Engines::skipUnlessAvailable($engine);

    $row = app(ConnectionFactory::class)->using(Engines::savedConnection($engine, ['read_only' => true]), fn (Connection $db) => (array) $db->selectOne('select @@session.sql_mode as m, @@session.transaction_read_only as ro'));

    expect($row['m'])->not->toContain('ANSI_QUOTES')->and((int) $row['ro'])->toBe(1);
})->with(['mysql', 'mariadb'])->skip(false);
