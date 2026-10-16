<?php

use App\Models\User;

beforeEach(function () {
    // Without an admin the app redirects /login to the setup screen.
    User::factory()->create();
});

test('a first visit without an appearance cookie renders dark', function () {
    $this->withoutVite();

    $html = $this->get('/login')->assertOk()->getContent();

    expect($html)->toMatch('/<html[^>]*class="dark"/');
    expect($html)->toContain("'dark'");
});

test('a saved light appearance renders without the dark class', function () {
    $this->withoutVite();

    $html = $this->withUnencryptedCookie('appearance', 'light')->get('/login')->assertOk()->getContent();

    expect($html)->not->toMatch('/<html[^>]*class="dark"/');
});

test('a saved system appearance defers to the inline script', function () {
    $this->withoutVite();

    $html = $this->withUnencryptedCookie('appearance', 'system')->get('/login')->assertOk()->getContent();

    expect($html)->not->toMatch('/<html[^>]*class="dark"/');
    expect($html)->toContain("'system'");
});
