<?php

namespace App\Http\Controllers;

use App\Models\SavedConnection;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class WorkspaceController extends Controller
{
    /** A fixed connection opens its workspace; a server-level one lists its databases, or opens the one named. */
    public function __invoke(SavedConnection $connection, ?string $database = null): Response|RedirectResponse
    {
        Gate::authorize('view', $connection);

        if ($database === null && $connection->isServerLevel()) {
            return Inertia::render('connections/databases', ['connection' => $connection->toClientArray()]);
        }

        if ($database !== null) {
            $scoped = $connection->scopedTo($database) ?? abort(404);
            if ($scoped === $connection) {
                return redirect()->route('workspace.show', $connection);
            }
            $connection = $scoped;
        }

        $connection->markOpened();

        return Inertia::render('workspace/show', ['connection' => $connection->toClientArray()]);
    }
}
