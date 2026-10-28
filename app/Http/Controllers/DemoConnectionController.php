<?php

namespace App\Http\Controllers;

use App\Enums\DriverName;
use App\Support\Demo\DemoDatabase;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Throwable;

/** "Try it with demo data": builds the demo SQLite database in the first allowed directory and opens it. */
class DemoConnectionController extends Controller
{
    public const FILE = 'dbzuper-demo.sqlite';

    public function __invoke(Request $request): RedirectResponse
    {
        $path = self::path();
        abort_if($path === null, 404);

        // Two clicks at once must not build the file twice.
        $connection = Cache::lock('dbzuper:demo', 30)->block(30, function () use ($request, $path) {
            if (! is_file($path)) {
                touch($path);
                try {
                    DemoDatabase::build($path);
                } catch (Throwable $e) {
                    @unlink($path);

                    throw $e;
                }
            }

            return $request->user()->connections()->firstOrCreate(
                ['driver' => DriverName::Sqlite, 'database' => $path],
                ['name' => 'Demo shop', 'color' => '#f59e0b', 'read_only' => false, 'store_history' => true],
            );
        });

        return redirect()->route('workspace.show', $connection->workspaceRef());
    }

    /** Where the demo database lives, or null when no SQLite directory is allowed (DBZUPER_SQLITE_PATHS). */
    public static function path(): ?string
    {
        $dir = config('dbzuper.sqlite_paths')[0] ?? null;

        return is_string($dir) && is_dir($dir) ? rtrim($dir, '/\\').DIRECTORY_SEPARATOR.self::FILE : null;
    }
}
