<?php

namespace App\Http\Controllers\Api;

use App\Database\DatabaseEntry;
use App\Database\DatabaseLister;
use App\Http\Controllers\Controller;
use App\Models\SavedConnection;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

class DatabaseController extends Controller
{
    /** The databases of a server-level connection; fixed connections and refs naming a database have none. */
    public function __invoke(SavedConnection $connection, DatabaseLister $lister): JsonResponse
    {
        Gate::authorize('view', $connection);
        abort_if(! $connection->isServerLevel() || $connection->scopedDatabase() !== null, 404);

        return response()->json([
            'databases' => array_map(fn (DatabaseEntry $e) => $e->toArray(), $lister->list($connection)),
            'last_database' => $connection->last_database,
        ]);
    }
}
