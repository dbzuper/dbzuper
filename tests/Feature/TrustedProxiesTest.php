<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

beforeEach(function () {
    Route::get('/_test/client-ip', fn (Request $request) => $request->ip());
});

function requestViaProxy(): string
{
    return test()->withServerVariables(['REMOTE_ADDR' => '10.0.0.5'])
        ->withHeader('X-Forwarded-For', '203.0.113.7')
        ->get('/_test/client-ip')->getContent();
}

it('trusts no proxy by default', function (?string $value) {
    config(['trustedproxy.proxies' => $value]);

    expect(requestViaProxy())->toBe('10.0.0.5');
})->with([null, '']);

it('trusts the proxies listed in TRUSTED_PROXIES', function () {
    config(['trustedproxy.proxies' => '10.0.0.0/8, 192.168.0.1']);

    expect(requestViaProxy())->toBe('203.0.113.7');
});

it('reads TRUSTED_PROXIES from the environment', function () {
    expect(require base_path('config/trustedproxy.php'))->toHaveKey('proxies');
});

it('builds https URLs from X-Forwarded-Proto sent by a trusted proxy', function () {
    config(['trustedproxy.proxies' => '10.0.0.0/8']);
    Route::get('/_test/url', fn () => url('/'));

    $url = test()->withServerVariables(['REMOTE_ADDR' => '10.0.0.5'])
        ->withHeader('X-Forwarded-Proto', 'https')
        ->get('/_test/url')->getContent();

    expect($url)->toStartWith('https://');
});

it('ignores X-Forwarded-Proto from an untrusted caller', function () {
    config(['trustedproxy.proxies' => null]);
    Route::get('/_test/url', fn () => url('/'));

    $url = test()->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])
        ->withHeader('X-Forwarded-Proto', 'https')
        ->get('/_test/url')->getContent();

    expect($url)->toStartWith('http://');
});
