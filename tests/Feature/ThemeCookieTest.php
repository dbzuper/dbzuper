<?php

use App\Models\User;

beforeEach(function () {
    // Without an admin the app redirects /login to the setup screen.
    User::factory()->create();
});

test('a saved theme cookie renders that theme', function () {
    $this->withoutVite();

    $html = $this->withUnencryptedCookie('theme', 'layered')->get('/login')->assertOk()->getContent();

    expect($html)->toMatch('/<html[^>]*data-theme="layered"/');
});

test('an unknown theme cookie falls back to classic', function () {
    $this->withoutVite();

    $html = $this->withUnencryptedCookie('theme', 'neon')->get('/login')->assertOk()->getContent();

    expect($html)->toMatch('/<html[^>]*data-theme="classic"/');
    expect($html)->not->toContain('neon');
});

test('a first visit without a theme cookie renders classic', function () {
    $this->withoutVite();

    $html = $this->get('/login')->assertOk()->getContent();

    expect($html)->toMatch('/<html[^>]*data-theme="classic"/');
});
