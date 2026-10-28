<?php

namespace Tests;

use App\Http\Middleware\RedirectToSetup;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Laravel\Fortify\Features;
use Tests\Support\Engines;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        RedirectToSetup::flush();
        parent::setUp();

        config(['dbzuper.sqlite_paths' => [Engines::sqliteDirectory()]]);
        // One setup code file per test process, so parallel workers never retire each other's code.
        config(['dbzuper.setup_code_path' => storage_path('framework/testing/setup-code-'.getmypid())]);
    }

    protected function skipUnlessFortifyHas(string $feature, ?string $message = null): void
    {
        if (! Features::enabled($feature)) {
            $this->markTestSkipped($message ?? "Fortify feature [{$feature}] is not enabled.");
        }
    }
}
