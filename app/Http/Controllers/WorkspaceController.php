<?php

namespace App\Http\Controllers;

use App\Models\SavedConnection;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class WorkspaceController extends Controller
{
    public function __invoke(SavedConnection $connection): Response
    {
        Gate::authorize('view', $connection);
        $connection->markOpened();

        return Inertia::render('workspace/show', ['connection' => $connection->toClientArray()]);
    }
}
