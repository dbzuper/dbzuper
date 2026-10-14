<?php

namespace App\Http\Controllers;

use App\Database\ConnectionTester;
use App\Http\Requests\ConnectionRequest;
use App\Models\SavedConnection;
use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;

class ConnectionTestController extends Controller
{
    public function __invoke(ConnectionRequest $request, ConnectionTester $tester): JsonResponse
    {
        $attributes = $request->connectionAttributes();

        if ($request->filled('connection_id') && ! array_key_exists('password', $attributes)) {
            $existing = $request->user()->connections()->findOrFail($request->integer('connection_id'));
            if (filled($existing->password) && $request->identityChangedFrom($existing)) {
                throw ValidationException::withMessages(['password' => 'Re-enter the password to test different server or connection settings.']);
            }
            $attributes['password'] = $existing->password;
        }

        return response()->json($tester->test(new SavedConnection($attributes)));
    }
}
