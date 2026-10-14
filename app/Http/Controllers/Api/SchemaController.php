<?php

namespace App\Http\Controllers\Api;

use App\Database\Schema\SnapshotService;
use App\Http\Controllers\Controller;
use App\Models\SavedConnection;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

class SchemaController extends Controller
{
    public function show(SavedConnection $connection, SnapshotService $snapshots): JsonResponse
    {
        Gate::authorize('view', $connection);

        return response()->json($snapshots->current($connection)->toApiArray());
    }

    public function refresh(SavedConnection $connection, SnapshotService $snapshots): JsonResponse
    {
        Gate::authorize('view', $connection);

        return response()->json($snapshots->refresh($connection)->toApiArray());
    }
}
