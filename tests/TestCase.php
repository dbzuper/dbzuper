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

        config(['dbsuperb.sqlite_paths' => [Engines::sqliteDirectory()]]);
    }

    protected function skipUnlessFortifyHas(string $feature, ?string $message = null): void
    {
        if (! Features::enabled($feature)) {
            $this->markTestSkipped($message ?? "Fortify feature [{$feature}] is not enabled.");
        }
    }
}
