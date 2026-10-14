<?php

use App\Http\Controllers\Api\SchemaController;
use App\Http\Controllers\SetupController;
use Illuminate\Support\Facades\Route;

Route::get('setup', [SetupController::class, 'show'])->name('setup.show');
Route::post('setup', [SetupController::class, 'store'])->middleware('throttle:10,1')->name('setup.store');

Route::middleware('auth')->group(function () {
    Route::redirect('/', '/connections')->name('home');
    Route::redirect('dashboard', '/connections')->name('dashboard');
    Route::post('connections/test', \App\Http\Controllers\ConnectionTestController::class)
        ->middleware('throttle:dbsuperb-api')->name('connections.test');
    Route::resource('connections', \App\Http\Controllers\ConnectionController::class)->except('show');

    Route::prefix('api/c/{connection}')->name('api.')->middleware('throttle:dbsuperb-api')->group(function () {
        Route::get('schema', [SchemaController::class, 'show'])->name('schema.show');
        Route::post('schema/refresh', [SchemaController::class, 'refresh'])->name('schema.refresh');
    });
});

require __DIR__.'/settings.php';
