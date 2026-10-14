<?php

namespace App\Http\Controllers;

use App\Actions\Fortify\CreateNewUser;
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

    public function store(Request $request, CreateNewUser $creator): RedirectResponse
    {
        abort_if(User::query()->exists(), 404);

        $user = $creator->create($request->only('name', 'email', 'password', 'password_confirmation'));
        $user->forceFill(['email_verified_at' => now()])->save();

        Auth::login($user);
        $request->session()->regenerate();

        return redirect()->route('connections.index');
    }
}
