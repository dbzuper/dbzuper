<?php

use App\Http\Controllers\Api\LayoutController;
use App\Http\Controllers\Api\SchemaController;
use App\Http\Controllers\Api\TableController;
use App\Http\Controllers\ConnectionController;
use App\Http\Controllers\ConnectionTestController;
use App\Http\Controllers\SetupController;
use App\Http\Controllers\WorkspaceController;
use Illuminate\Support\Facades\Route;

Route::get('setup', [SetupController::class, 'show'])->name('setup.show');
Route::post('setup', [SetupController::class, 'store'])->middleware('throttle:10,1')->name('setup.store');

Route::middleware('auth')->group(function () {
    Route::redirect('/', '/connections')->name('home');
    Route::redirect('dashboard', '/connections')->name('dashboard');
    Route::post('connections/test', ConnectionTestController::class)
        ->middleware('throttle:dbsuperb-api')->name('connections.test');
    Route::resource('connections', ConnectionController::class)->except('show');

    Route::get('c/{connection}', WorkspaceController::class)->name('workspace.show');

    Route::prefix('api/c/{connection}')->name('api.')->middleware('throttle:dbsuperb-api')->group(function () {
        Route::get('schema', [SchemaController::class, 'show'])->name('schema.show');
        Route::post('schema/refresh', [SchemaController::class, 'refresh'])->name('schema.refresh');
        Route::get('layout', [LayoutController::class, 'show'])->name('layout.show');
        Route::put('layout', [LayoutController::class, 'update'])->name('layout.update');
        Route::get('tables/{table}/sample', [TableController::class, 'sample'])->where('table', '.+')->name('tables.sample');
        Route::get('tables/{table}/ddl', [TableController::class, 'ddl'])->where('table', '.+')->name('tables.ddl');
    });
});

require __DIR__.'/settings.php';
