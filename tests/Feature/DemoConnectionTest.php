<?php

use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Engines;

beforeEach(function () {
    $this->withoutVite();
    $this->user = User::factory()->create();
    $this->demo = Engines::sqliteDirectory().DIRECTORY_SEPARATOR.'dbzuper-demo.sqlite';
    @unlink($this->demo);
});
afterEach(fn () => @unlink($this->demo));

it('builds the demo database, adds its connection and opens it', function () {
    $response = $this->actingAs($this->user)->post('/connections/demo');

    $connection = SavedConnection::sole();
    $response->assertRedirect(route('workspace.show', $connection->workspaceRef()));
    expect($connection->user_id)->toBe($this->user->id)
        ->and($connection->driver)->toBe(DriverName::Sqlite)
        ->and($connection->database)->toBe($this->demo)
        ->and($connection->name)->toBe('Demo shop')
        ->and(filesize($this->demo))->toBeGreaterThan(0);
});

it('opens the existing demo connection instead of adding another', function () {
    $this->actingAs($this->user)->post('/connections/demo');
    $first = SavedConnection::sole();
    $built = filemtime($this->demo);

    $this->actingAs($this->user)->post('/connections/demo')
        ->assertRedirect(route('workspace.show', $first->workspaceRef()));
    expect(SavedConnection::count())->toBe(1)
        ->and(filemtime($this->demo))->toBe($built);
});

it('refuses when no SQLite directory is allowed', function () {
    config(['dbzuper.sqlite_paths' => []]);

    $this->actingAs($this->user)->post('/connections/demo')->assertNotFound();
    expect(SavedConnection::count())->toBe(0);
});

it('needs a signed-in user', function () {
    $this->post('/connections/demo')->assertRedirect(route('login'));
    expect(SavedConnection::count())->toBe(0);
});

it('tells the connections page whether the demo can be added', function (bool $allowed) {
    config(['dbzuper.sqlite_paths' => $allowed ? [Engines::sqliteDirectory()] : []]);

    $this->actingAs($this->user)->get('/connections')
        ->assertInertia(fn (Assert $page) => $page->where('canTryDemo', $allowed));
})->with(['allowed directory' => [true], 'no directory' => [false]]);
