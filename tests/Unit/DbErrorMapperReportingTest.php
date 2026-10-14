<?php

use App\Database\Errors\DbErrorMapper;
use App\Database\Exceptions\InvalidConnectionOption;
use Illuminate\Support\Facades\Exceptions;
use Tests\TestCase;

uses(TestCase::class);

it('reports non-database exceptions it maps to unknown', function () {
    Exceptions::fake();

    $error = (new DbErrorMapper)->map(new RuntimeException('bug in our code'));

    expect($error->kind)->toBe('unknown');
    Exceptions::assertReported(fn (RuntimeException $e) => $e->getMessage() === 'bug in our code');
});

it('does not report expected database and option errors', function () {
    Exceptions::fake();

    (new DbErrorMapper)->map(new PDOException('SQLSTATE[HY000] [1045] Access denied for user', 1045));
    (new DbErrorMapper)->map(new InvalidConnectionOption('Invalid characters in host.'));

    Exceptions::assertNothingReported();
});
