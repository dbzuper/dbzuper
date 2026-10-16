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

it('reports the masked literals for scrubbing text derived from the SQL', function () {
    $r = SqlRedactor::scan("ALTER ROLE x PASSWORD 's3cret'", 'pgsql');

    expect($r['secrets'])->toBe(["'s3cret'"]);
});
