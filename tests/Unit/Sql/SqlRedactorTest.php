<?php

use App\Database\Sql\SqlRedactor;

it('masks credential literals', function (string $dialect, string $sql, string $expected) {
    $out = SqlRedactor::redact($sql, $dialect);

    expect($out)->toBe($expected)->and($out)->not->toContain('s3cret');
})->with([
    'pg password' => ['pgsql', "ALTER ROLE x PASSWORD 's3cret'", "ALTER ROLE x PASSWORD '***'"],
    'pg lowercase' => ['pgsql', "alter role x with password 's3cret' login", "alter role x with password '***' login"],
    'pg encrypted password' => ['pgsql', "CREATE ROLE x ENCRYPTED PASSWORD 's3cret'", "CREATE ROLE x ENCRYPTED PASSWORD '***'"],
    'pg doubled quote' => ['pgsql', "ALTER ROLE x PASSWORD 's3''cret'", "ALTER ROLE x PASSWORD '***'"],
    'pg E string' => ['pgsql', "ALTER ROLE x PASSWORD E's3\'cret'", "ALTER ROLE x PASSWORD '***'"],
    'pg dollar quoted' => ['pgsql', 'ALTER ROLE x PASSWORD $$s3cret$$', "ALTER ROLE x PASSWORD '***'"],
    'pg tagged dollar quoted' => ['pgsql', 'ALTER ROLE x PASSWORD $t$s3c\'ret$t$ VALID UNTIL \'infinity\'', "ALTER ROLE x PASSWORD '***' VALID UNTIL 'infinity'"],
    'pg comment between' => ['pgsql', "ALTER ROLE x PASSWORD /* hi */ 's3cret'", "ALTER ROLE x PASSWORD /* hi */ '***'"],
    'pg user mapping option' => ['pgsql', "CREATE USER MAPPING FOR u SERVER s OPTIONS (user 'a', password 's3cret')", "CREATE USER MAPPING FOR u SERVER s OPTIONS (user 'a', password '***')"],
    'mysql identified by' => ['mysql', "CREATE USER u IDENTIFIED BY 's3cret'", "CREATE USER u IDENTIFIED BY '***'"],
    'mysql lowercase' => ['mysql', "create user u identified by 's3cret' password expire", "create user u identified by '***' password expire"],
    'mysql double quotes' => ['mysql', 'CREATE USER u IDENTIFIED BY "s3cret"', "CREATE USER u IDENTIFIED BY '***'"],
    'mysql backslash escape' => ['mysql', "CREATE USER u IDENTIFIED BY 's3\'cret'", "CREATE USER u IDENTIFIED BY '***'"],
    'mysql identified with by' => ['mysql', "CREATE USER u IDENTIFIED WITH caching_sha2_password BY 's3cret'", "CREATE USER u IDENTIFIED WITH caching_sha2_password BY '***'"],
    'mysql identified with as hash' => ['mysql', "ALTER USER u IDENTIFIED WITH mysql_native_password AS 's3cret'", "ALTER USER u IDENTIFIED WITH mysql_native_password AS '***'"],
    'mysql identified by password hash' => ['mariadb', "CREATE USER u IDENTIFIED BY PASSWORD 's3cret'", "CREATE USER u IDENTIFIED BY PASSWORD '***'"],
    'mariadb using password()' => ['mariadb', "CREATE USER u IDENTIFIED VIA mysql_native_password USING PASSWORD('s3cret')", "CREATE USER u IDENTIFIED VIA mysql_native_password USING PASSWORD('***')"],
    'mysql set password' => ['mysql', "SET PASSWORD = 's3cret'", "SET PASSWORD = '***'"],
    'mysql set password for' => ['mysql', "SET PASSWORD FOR 'u'@'h' = 's3cret'", "SET PASSWORD FOR 'u'@'h' = '***'"],
    'mysql alter user replace old' => ['mysql', "ALTER USER u IDENTIFIED BY 'new' REPLACE 'old'", "ALTER USER u IDENTIFIED BY '***' REPLACE '***'"],
    'mysql set password replace old' => ['mysql', "SET PASSWORD = 'new' REPLACE 'old'", "SET PASSWORD = '***' REPLACE '***'"],
    'mysql charset introducer' => ['mysql', "CREATE USER u IDENTIFIED BY _utf8mb4's3cret'", "CREATE USER u IDENTIFIED BY '***'"],
    'mysql charset introducer upper' => ['mysql', "SET PASSWORD = _UTF8'x' 's3cret'", "SET PASSWORD = '***'"],
    'mysql adjacent literals' => ['mysql', "CREATE USER u IDENTIFIED BY 's3c' 'ret' PASSWORD EXPIRE", "CREATE USER u IDENTIFIED BY '***' PASSWORD EXPIRE"],
    'mysql adjacent literals across a comment' => ['mysql', "CREATE USER u IDENTIFIED BY 's3c' /* x */ \"ret\"", "CREATE USER u IDENTIFIED BY '***'"],
    'pg unicode escape string' => ['pgsql', "ALTER ROLE x PASSWORD U&'s3cret'", "ALTER ROLE x PASSWORD '***'"],
    'mysql source_password' => ['mysql', "CHANGE REPLICATION SOURCE TO SOURCE_HOST = 'h', SOURCE_PASSWORD = 's3cret'", "CHANGE REPLICATION SOURCE TO SOURCE_HOST = 'h', SOURCE_PASSWORD = '***'"],
    'mariadb master_password' => ['mariadb', "CHANGE MASTER TO MASTER_PASSWORD='s3cret', MASTER_USER='u'", "CHANGE MASTER TO MASTER_PASSWORD='***', MASTER_USER='u'"],
    'pg subscription connection' => ['pgsql', "CREATE SUBSCRIPTION s CONNECTION 'host=h user=u password=s3cret dbname=d' PUBLICATION p", "CREATE SUBSCRIPTION s CONNECTION 'host=h user=u password=*** dbname=d' PUBLICATION p"],
    'pg alter subscription connection spaced' => ['pgsql', "ALTER SUBSCRIPTION s CONNECTION 'host=h Password = s3cret'", "ALTER SUBSCRIPTION s CONNECTION 'host=h Password = ***'"],
    'pg dblink_connect' => ['pgsql', "select dblink_connect('c', 'host=h password=s3cret')", "select dblink_connect('c', 'host=h password=***')"],
    'pg dblink query' => ['pgsql', "select * from dblink('host=h password=s3cret', 'select 1') as t(a int)", "select * from dblink('host=h password=***', 'select 1') as t(a int)"],
    'pg quoted conninfo password' => ['pgsql', "select dblink_connect('host=h password=''s3cret pw'' dbname=d')", "select dblink_connect('host=h password=*** dbname=d')"],
    'mysql second factor' => ['mysql', "ALTER USER u IDENTIFIED BY 's3cret' AND IDENTIFIED WITH authentication_fido", "ALTER USER u IDENTIFIED BY '***' AND IDENTIFIED WITH authentication_fido"],
]);

it('leaves statements without credentials untouched', function (string $dialect, string $sql) {
    expect(SqlRedactor::redact($sql, $dialect))->toBe($sql);
})->with([
    ['pgsql', "select 'a' as x, 'password' as y"],
    ['mysql', "select * from t where name = 'by' and note = 'identified by x'"],
    ['sqlite', "select 1 -- password 'x'"],
    ['mysql', 'CREATE USER u IDENTIFIED WITH auth_socket'],
    ['pgsql', 'ALTER ROLE x PASSWORD NULL'],
]);

it('reports decoded literal bodies for scrubbing error text', function (string $dialect, string $sql, array $needles) {
    $r = SqlRedactor::scan($sql, $dialect);

    foreach ($needles as $needle) {
        expect($r['secrets'])->toContain($needle);
    }
})->with([
    'plain' => ['mysql', "CREATE USER u IDENTIFIED BY 'Eagle1'", ['Eagle1']],
    'doubled quote' => ['pgsql', "ALTER ROLE x PASSWORD 's3''cret'", ["s3'cret"]],
    'tagged dollar' => ['pgsql', 'ALTER ROLE x PASSWORD $t$$cret1$t$', ['$cret1']],
    'E string' => ['pgsql', "ALTER ROLE x PASSWORD e's3\'cret'", ["s3'cret"]],
    'concatenated' => ['mysql', "CREATE USER u IDENTIFIED BY 's3c' 'ret!'", ['s3cret!']],
    'conninfo value' => ['pgsql', "select dblink_connect('host=h password=s3cret')", ['s3cret']],
]);

it('reports the masked literals for scrubbing text derived from the SQL', function () {
    $r = SqlRedactor::scan("ALTER ROLE x PASSWORD 's3cret'", 'pgsql');

    expect($r['secrets'])->toContain("'s3cret'");
});
