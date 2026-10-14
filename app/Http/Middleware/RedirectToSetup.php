<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RedirectToSetup
{
    /** Once an admin exists it stays that way (accounts cannot be deleted), so a positive answer is cached for the process. */
    private static bool $adminExists = false;

    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->routeIs('setup.*') && ! self::adminExists()) {
            return redirect()->route('setup.show');
        }

        return $next($request);
    }

    public static function adminExists(): bool
    {
        return self::$adminExists = self::$adminExists || User::query()->exists();
    }

    /** Forget the cached answer (tests start from an empty database). */
    public static function flush(): void
    {
        self::$adminExists = false;
    }
}
