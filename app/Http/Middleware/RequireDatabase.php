<?php

namespace App\Http\Middleware;

use App\Models\SavedConnection;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Workspace API calls on a server-level connection must name the database they are for. */
class RequireDatabase
{
    public function handle(Request $request, Closure $next): Response
    {
        $connection = $request->route('connection');
        if ($connection instanceof SavedConnection && $connection->isServerLevel() && $connection->scopedDatabase() === null) {
            abort(404);
        }

        return $next($request);
    }
}
