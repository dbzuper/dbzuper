<?php

use App\Support\SetupCode;
use Tests\TestCase;

uses(TestCase::class);

beforeEach(fn () => app(SetupCode::class)->forget());
afterEach(fn () => app(SetupCode::class)->forget());

it('issues a readable code and keeps it until forgotten', function () {
    $codes = app(SetupCode::class);
    $code = $codes->current();

    expect($code)->toMatch('/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/')
        ->and($codes->current())->toBe($code)
        ->and(app(SetupCode::class)->current())->toBe($code);
});

it('matches regardless of case, spaces and dashes', function () {
    $codes = app(SetupCode::class);
    $code = $codes->current();

    expect($codes->matches($code))->toBeTrue()
        ->and($codes->matches(strtolower(str_replace('-', ' ', $code))))->toBeTrue()
        ->and($codes->matches(str_replace('-', '', $code)))->toBeTrue()
        ->and($codes->matches('AAAA-AAAA-AAAA'))->toBeFalse()
        ->and($codes->matches(''))->toBeFalse();
});

it('never matches before a code was issued', function () {
    expect(app(SetupCode::class)->matches(''))->toBeFalse();
});

it('issues a new code once the old one is forgotten', function () {
    $codes = app(SetupCode::class);
    $first = $codes->current();
    $codes->forget();

    expect($codes->matches($first))->toBeFalse()
        ->and($codes->current())->not->toBe($first);
});

it('keeps the code file private to the app user', function () {
    app(SetupCode::class)->current();

    expect(is_file(config('dbzuper.setup_code_path')))->toBeTrue();
    if (DIRECTORY_SEPARATOR === '/') {
        expect(fileperms(config('dbzuper.setup_code_path')) & 0777)->toBe(0600);
    }
});
