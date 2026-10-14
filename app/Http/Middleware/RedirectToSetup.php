<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RedirectToSetup
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->routeIs('setup.*') && ! User::query()->exists()) {
            return redirect()->route('setup.show');
        }

        return $next($request);
    }
}
