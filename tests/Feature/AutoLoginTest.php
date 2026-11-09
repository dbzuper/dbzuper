<?php

use App\Models\User;
use Illuminate\Support\Facades\Log;

const AUTO_LOGIN_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// Auto sign-in turned on as laman does it: the setting, the key's hash and a local APP_URL.
function enableAutoLogin(string $appUrl = 'https://dbzuper.test'): void
{
    config([
        'dbzuper.auto_login' => true,
        'dbzuper.auto_login_hash' => hash('sha256', AUTO_LOGIN_KEY),
        'app.url' => $appUrl,
    ]);
}

// A request to /connections, as it would arrive: from REMOTE_ADDR, for Host, with extra headers, and with the
// key the web server passes (null: a web server that passes none).
function localVisit(string $host = 'dbzuper.test', string $from = '127.0.0.1', array $headers = [], ?string $key = AUTO_LOGIN_KEY)
{
    $server = ['REMOTE_ADDR' => $from];
    if ($key !== null) {
        $server['DBZUPER_AUTO_LOGIN_KEY'] = $key;
    }

    // A full URL: the test client takes the Host from it.
    return test()->withServerVariables($server)
        ->withHeaders($headers)
        ->get("http://{$host}/connections");
}

it('is off by default: guests get the login page', function () {
    User::factory()->create();

    localVisit()->assertRedirect(route('login'));
    $this->assertGuest();
});

it('signs a local request in as the administrator', function () {
    enableAutoLogin();
    $admin = User::factory()->create();
    User::factory()->create();

    localVisit()->assertOk();
    $this->assertAuthenticatedAs($admin);
    expect(session('auto_login'))->toBeTrue();
});

it('tells the interface the sign-in was automatic', function () {
    enableAutoLogin();
    User::factory()->create();

    localVisit()->assertInertia(fn ($page) => $page->where('auth.automatic', true));
});

it('does not mark a normal sign-in as automatic', function () {
    $this->actingAs(User::factory()->create())
        ->get('/connections')
        ->assertInertia(fn ($page) => $page->where('auth.automatic', false));
});

it('accepts laman behind Caddy: forwarded for loopback', function () {
    enableAutoLogin();
    User::factory()->create();

    localVisit(headers: ['X-Forwarded-For' => '127.0.0.1', 'Forwarded' => 'for="[::1]:51000"'])->assertOk();
    $this->assertAuthenticated();
});

it('also accepts localhost, loopback IPs and .localhost names', function (string $host) {
    enableAutoLogin();
    User::factory()->create();

    localVisit($host)->assertOk();
    $this->assertAuthenticated();
})->with(['localhost', '127.0.0.1', 'db.localhost']);

it('does nothing when the web server passes no key, or the wrong one', function (?string $key) {
    enableAutoLogin();
    User::factory()->create();

    localVisit(key: $key)->assertRedirect(route('login'));
    $this->assertGuest();
})->with([
    'no key' => [null],
    'wrong key' => [str_repeat('f', 64)],
    'the hash itself' => [hash('sha256', AUTO_LOGIN_KEY)],
]);

it('does nothing without a valid hash configured', function (?string $hash) {
    enableAutoLogin();
    config(['dbzuper.auto_login_hash' => $hash]);
    User::factory()->create();

    localVisit(key: '')->assertRedirect(route('login'));
    localVisit()->assertRedirect(route('login'));
    $this->assertGuest();
})->with(['unset' => [null], 'empty' => [''], 'not a hash' => ['secret']]);

it('cannot be faked with a header named like the key', function () {
    enableAutoLogin();
    User::factory()->create();

    localVisit(headers: ['DBZUPER_AUTO_LOGIN_KEY' => AUTO_LOGIN_KEY, 'Dbzuper-Auto-Login-Key' => AUTO_LOGIN_KEY], key: null)
        ->assertRedirect(route('login'));
    $this->assertGuest();
});

it('does nothing when APP_URL is not a local address', function () {
    enableAutoLogin('https://db.example.com');
    User::factory()->create();

    localVisit()->assertRedirect(route('login'));
    $this->assertGuest();
});

it('refuses requests from another machine', function () {
    enableAutoLogin();
    User::factory()->create();

    localVisit(from: '192.168.1.20')->assertRedirect(route('login'));
    $this->assertGuest();
});

it('refuses a local proxy forwarding someone else', function (array $headers) {
    enableAutoLogin();
    User::factory()->create();

    localVisit(headers: $headers)->assertRedirect(route('login'));
    $this->assertGuest();
})->with([
    'X-Forwarded-For' => [['X-Forwarded-For' => '203.0.113.9']],
    'mixed chain' => [['X-Forwarded-For' => '127.0.0.1, 203.0.113.9']],
    'Forwarded' => [['Forwarded' => 'for=203.0.113.9;proto=https']],
]);

it('refuses tunnels and CDNs, whatever address they claim', function (string $header) {
    enableAutoLogin();
    User::factory()->create();

    localVisit(headers: [$header => '127.0.0.1'])->assertRedirect(route('login'));
    $this->assertGuest();
})->with(['CF-Connecting-IP', 'True-Client-IP', 'X-Real-IP', 'X-Client-IP', 'Fastly-Client-IP']);

it('refuses public host names even from loopback', function () {
    enableAutoLogin();
    User::factory()->create();

    localVisit('db.example.com')->assertRedirect(route('login'));
    $this->assertGuest();
});

it('leaves a fresh install on the setup screen', function () {
    enableAutoLogin();

    localVisit()->assertRedirect(route('setup.show'));
    $this->assertGuest();
});

it('logs each automatic sign-in', function () {
    enableAutoLogin();
    $admin = User::factory()->create();
    Log::spy();

    localVisit();

    Log::shouldHaveReceived('notice')->once()
        ->withArgs(fn (string $message, array $context) => str_contains($message, 'Signed in automatically')
            && $context['user'] === $admin->email);
});

it('warns, at most hourly, when the setting is on but a request is refused', function () {
    enableAutoLogin();
    User::factory()->create();
    Log::spy();

    localVisit(key: null);
    localVisit(key: null);

    Log::shouldHaveReceived('warning')->once()
        ->withArgs(fn (string $message) => str_contains($message, 'did not pass a matching DBZUPER_AUTO_LOGIN_KEY'));
});
