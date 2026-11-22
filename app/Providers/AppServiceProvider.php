<?php

namespace App\Providers;

use App\Database\SqlitePathPolicy;
use App\Transfers\Export\BuiltinExporters;
use App\Transfers\Export\MySqlBuiltinExporter;
use App\Transfers\Export\SqliteBuiltinExporter;
use App\Transfers\WorkerHeartbeat;
use Carbon\CarbonImmutable;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\DevCommands;
use Illuminate\Http\Request;
use Illuminate\Queue\Events\Looping;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Task 9 adds PostgreSQL (driver value => exporter class).
        $this->app->singleton(BuiltinExporters::class, fn () => new BuiltinExporters([
            'mysql' => MySqlBuiltinExporter::class,
            'mariadb' => MySqlBuiltinExporter::class,
            'sqlite' => SqliteBuiltinExporter::class,
        ]));
        $this->app->bind(SqlitePathPolicy::class, fn () => new SqlitePathPolicy(config('dbzuper.sqlite_paths')));
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureDefaults();

        // A transfers worker proves it is alive while idle; TransferProgress beats while a job runs.
        Event::listen(Looping::class, function (Looping $event) {
            if ($event->connectionName === 'transfers') {
                WorkerHeartbeat::beat();
            }
        });
        DevCommands::artisan('queue:work transfers --queue=transfers --tries=1 --timeout=0', 'transfers');

        RateLimiter::for('dbzuper-api', fn (Request $request) => Limit::perMinute((int) config('dbzuper.api_per_minute'))->by($request->user()?->id ?: $request->ip()));
        // Exploring records fires a request per card and per port, far more often than the rest of the API.
        RateLimiter::for('dbzuper-records', fn (Request $request) => Limit::perMinute(1000)->by($request->user()?->id ?: $request->ip()));
    }

    /**
     * Configure default behaviors for production-ready applications.
     */
    protected function configureDefaults(): void
    {
        Date::use(CarbonImmutable::class);

        DB::prohibitDestructiveCommands(
            app()->isProduction(),
        );

        Password::defaults(fn (): ?Password => match (true) {
            ! app()->isProduction() => null,
            // For a private, local install: any 8 characters, and no breach lookup.
            config('dbzuper.password_policy') === 'basic' => Password::min(8),
            default => Password::min(12)
                ->mixedCase()
                ->letters()
                ->numbers()
                ->symbols()
                ->uncompromised(),
        });
    }
}
