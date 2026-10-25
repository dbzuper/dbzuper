<?php

use App\Models\User;
use Illuminate\Foundation\Vite;
use Illuminate\Support\HtmlString;

beforeEach(function () {
    // Without an admin the app redirects /login to the setup screen.
    User::factory()->create();
});

test('a saved theme cookie renders that theme', function (string $theme) {
    $this->withoutVite();

    $html = $this->withUnencryptedCookie('theme', $theme)->get('/login')->assertOk()->getContent();

    expect($html)->toMatch('/<html[^>]*data-theme="'.$theme.'"/');
})->with(['layered', 'radar']);

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

/** Renders every @vite call as an HTML comment naming its entry points, so a test can see which ones load. */
function listViteEntries(): void
{
    Illuminate\Support\Facades\Vite::clearResolvedInstance();

    app()->instance(Vite::class, new class extends Vite
    {
        public function __invoke($entrypoints, $buildDirectory = null)
        {
            return new HtmlString('<!-- vite: '.implode(' ', (array) $entrypoints).' -->');
        }

        public function reactRefresh()
        {
            return '';
        }
    });
}

test('the graphite theme cookie loads the graphite fonts on first paint', function () {
    listViteEntries();

    $html = $this->withUnencryptedCookie('theme', 'graphite')->get('/login')->assertOk()->getContent();

    expect($html)->toContain('<!-- vite: resources/css/fonts-graphite.css -->');
});

test('other themes do not load the graphite fonts', function (?string $theme) {
    listViteEntries();

    $request = $theme === null ? $this : $this->withUnencryptedCookie('theme', $theme);
    $html = $request->get('/login')->assertOk()->getContent();

    expect($html)->toContain('<!-- vite: resources/css/app.css')
        ->not->toContain('fonts-graphite');
})->with(['classic', 'layered', 'radar', 'neon', null]);
