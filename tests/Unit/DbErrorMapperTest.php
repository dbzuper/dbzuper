<?php

use App\Database\Errors\DbErrorMapper;
use App\Database\Exceptions\SqlitePathNotAllowed;

function pdoError(string $message, int|string $code = 0, ?array $errorInfo = null): PDOException
{
    $e = new PDOException($message, is_int($code) ? $code : 0);
    if ($errorInfo !== null) {
        $e->errorInfo = $errorInfo;
    }

    return $e;
}

it('maps errors to kind and reason', function (Throwable $e, string $kind, ?string $reason, ?string $sqlstate) {
    $error = (new DbErrorMapper)->map($e);

    expect($error->kind)->toBe($kind)->and($error->reason)->toBe($reason)->and($error->sqlstate)->toBe($sqlstate);
})->with([
    'mysql refused' => [pdoError('SQLSTATE[HY000] [2002] No connection could be made because the target machine actively refused it', 2002), 'connection', 'refused', 'HY000'],
    'windows timeout' => [pdoError('SQLSTATE[HY000] [2002] A connection attempt failed because the connected party did not properly respond after a period of time, or established connection failed because connected host has failed to respond', 2002), 'timeout', 'timeout', 'HY000'],
    'mysql dns' => [pdoError('SQLSTATE[HY000] [2002] php_network_getaddresses: getaddrinfo for nope.invalid failed', 2002), 'connection', 'dns', 'HY000'],
    'mysql timeout' => [pdoError('SQLSTATE[HY000] [2002] Connection timed out', 2002), 'timeout', 'timeout', 'HY000'],
    'mysql auth' => [pdoError("SQLSTATE[HY000] [1045] Access denied for user 'root'@'x'", 1045), 'auth', 'auth', 'HY000'],
    'mysql unknown db' => [pdoError("SQLSTATE[HY000] [1049] Unknown database 'nope'", 1049), 'not_found', 'unknown_database', 'HY000'],
    'mysql readonly' => [pdoError('SQLSTATE[25006]: Read only sql transaction: 1792 Cannot execute statement in a READ ONLY transaction.', 0, ['25006', 1792, 'x']), 'readonly', null, '25006'],
    'mysql syntax' => [pdoError('SQLSTATE[42000]: Syntax error or access violation: 1064 You have an error', 0, ['42000', 1064, 'x']), 'syntax', null, '42000'],
    'pg refused' => [pdoError('SQLSTATE[08006] [7] connection to server at "127.0.0.1", port 1 failed: Connection refused'), 'connection', 'refused', '08006'],
    'pg dns' => [pdoError('SQLSTATE[08006] [7] could not translate host name "nope.invalid" to address'), 'connection', 'dns', '08006'],
    'pg auth' => [pdoError('SQLSTATE[08006] [7] connection failed: FATAL:  password authentication failed for user "x"'), 'auth', 'auth', '08006'],
    'pg unknown db' => [pdoError('SQLSTATE[08006] [7] connection failed: FATAL:  database "nope" does not exist'), 'not_found', 'unknown_database', '08006'],
    'pg tls' => [pdoError('SQLSTATE[08006] [7] connection failed: FATAL:  no pg_hba.conf entry for host "x", user "y", database "z", no encryption'), 'connection', 'tls', '08006'],
    'pg readonly' => [pdoError('SQLSTATE[25006]: Read only sql transaction: 7 ERROR:  cannot execute INSERT in a read-only transaction', 0, ['25006', 7, 'x']), 'readonly', null, '25006'],
    'pg timeout' => [pdoError('SQLSTATE[57014]: Query canceled: 7 ERROR:  canceling statement due to statement timeout', 0, ['57014', 7, 'x']), 'timeout', null, '57014'],
    'pg permission' => [pdoError('SQLSTATE[42501]: Insufficient privilege', 0, ['42501', 7, 'x']), 'permission', null, '42501'],
    'sqlite readonly' => [pdoError('SQLSTATE[HY000]: General error: 8 attempt to write a readonly database', 0, ['HY000', 8, 'x']), 'readonly', null, 'HY000'],
    'sqlite missing' => [new SqlitePathNotAllowed('missing', 'The SQLite file does not exist.'), 'not_found', 'sqlite_missing', null],
    'sqlite outside' => [new SqlitePathNotAllowed('outside', 'outside'), 'permission', 'sqlite_outside', null],
    'invalid option' => [new InvalidArgumentException('Invalid characters in host.'), 'connection', 'invalid_option', null],
    'unknown' => [new RuntimeException('boom'), 'unknown', null, null],
]);

it('keeps the safe message for invalid options and hides arbitrary exception messages', function () {
    $mapper = new DbErrorMapper;

    expect($mapper->map(new InvalidArgumentException('Invalid characters in host.'))->message)->toBe('Invalid characters in host.')
        ->and($mapper->map(new RuntimeException('secret-password-123'))->message)->toBe('An unexpected error occurred.');
});

it('strips the SQLSTATE prefix and connection details from the message', function () {
    $error = (new DbErrorMapper)->map(pdoError("SQLSTATE[HY000] [1045] Access denied for user 'root'@'x' (Connection: dbsuperb_1_abc, SQL: select 1)", 1045));

    expect($error->message)->toBe("Access denied for user 'root'@'x'");
});

it('strips the full Laravel connection suffix (host, port, database, sql)', function () {
    $error = (new DbErrorMapper)->map(pdoError("SQLSTATE[HY000] [1045] Access denied for user 'root'@'x' (using password: YES) (Connection: dbsuperb_transient_abc, Host: 127.0.0.1, Port: 3307, Database: db, SQL: select version() as version)", 1045));

    expect($error->message)->toBe("Access denied for user 'root'@'x' (using password: YES)");
});
