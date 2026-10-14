<?php

use App\Http\Controllers\SetupController;
use Illuminate\Support\Facades\Route;

Route::get('setup', [SetupController::class, 'show'])->name('setup.show');
Route::post('setup', [SetupController::class, 'store'])->middleware('throttle:10,1')->name('setup.store');

Route::middleware('auth')->group(function () {
    Route::redirect('/', '/connections')->name('home');
    Route::redirect('dashboard', '/connections')->name('dashboard');
    Route::inertia('connections', 'dashboard')->name('connections.index'); // replaced in Task 12
});

require __DIR__.'/settings.php';
