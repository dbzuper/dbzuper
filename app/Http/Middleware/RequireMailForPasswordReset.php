<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Fortify's reset routes email a link, so they answer only once a mailer is set up: the default `log` mailer sends
 * nothing. Without one, `php artisan dbzuper:reset-password` is how a password is reset.
 */
class RequireMailForPasswordReset
{
    private const ROUTES = ['password.request', 'password.email', 'password.reset', 'password.update'];

    public static function mailConfigured(): bool
    {
        return config('mail.default') !== 'log';
    }

    public function handle(Request $request, Closure $next): Response
    {
        abort_if($request->routeIs(...self::ROUTES) && ! self::mailConfigured(), 404);

        return $next($request);
    }
}
