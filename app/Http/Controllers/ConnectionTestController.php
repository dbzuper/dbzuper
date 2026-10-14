<?php

namespace App\Http\Controllers;

use App\Database\ConnectionTester;
use App\Http\Requests\ConnectionRequest;
use App\Models\SavedConnection;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

class ConnectionTestController extends Controller
{
    public function __invoke(ConnectionRequest $request, ConnectionTester $tester): JsonResponse
    {
        $attributes = $request->connectionAttributes();

        if ($request->filled('connection_id') && ! array_key_exists('password', $attributes)) {
            $existing = SavedConnection::findOrFail($request->integer('connection_id'));
            Gate::authorize('update', $existing);
            $attributes['password'] = $existing->password;
        }

        return response()->json($tester->test(new SavedConnection($attributes)));
    }
}
