<?php

namespace App\Http\Controllers;

use App\Actions\CreateFirstAdmin;
use App\Models\User;
use App\Support\SetupCode;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

class SetupController extends Controller
{
    public function show(SetupCode $setupCode): Response
    {
        abort_if(User::query()->exists(), 404);
        // Issue the code now, so it is ready for `dbzuper:setup-code` (the server log has it from start).
        $setupCode->current();

        return Inertia::render('setup');
    }

    public function store(Request $request, CreateFirstAdmin $createFirstAdmin, SetupCode $setupCode): RedirectResponse
    {
        abort_if(User::query()->exists(), 404);
        if (! $setupCode->matches((string) $request->input('setup_code', ''))) {
            throw ValidationException::withMessages(['setup_code' => "That isn't the setup code. Check the server log, or run php artisan dbzuper:setup-code."]);
        }

        $user = $createFirstAdmin->handle($request->only('name', 'email', 'password', 'password_confirmation'));
        abort_if($user === null, 404);

        Auth::login($user);
        $request->session()->regenerate();

        return redirect()->route('connections.index');
    }
}
