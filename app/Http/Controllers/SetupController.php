<?php

namespace App\Http\Controllers;

use App\Actions\CreateFirstAdmin;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Inertia\Response;

class SetupController extends Controller
{
    public function show(): Response
    {
        abort_if(User::query()->exists(), 404);

        return Inertia::render('setup');
    }

    public function store(Request $request, CreateFirstAdmin $createFirstAdmin): RedirectResponse
    {
        abort_if(User::query()->exists(), 404);

        $user = $createFirstAdmin->handle($request->only('name', 'email', 'password', 'password_confirmation'));
        abort_if($user === null, 404);

        Auth::login($user);
        $request->session()->regenerate();

        return redirect()->route('connections.index');
    }
}
