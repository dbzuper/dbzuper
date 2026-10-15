<?php

use App\Http\Controllers\Api\HistoryController;
use App\Http\Controllers\Api\LayoutController;
use App\Http\Controllers\Api\QueryController;
use App\Http\Controllers\Api\SchemaController;
use App\Http\Controllers\Api\TableController;
use App\Http\Controllers\Api\TableRowsController;
use App\Http\Controllers\ConnectionController;
use App\Http\Controllers\ConnectionTestController;
use App\Http\Controllers\HistoryPageController;
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

    Route::get('history', HistoryPageController::class)->name('history.index');
    Route::get('api/history', [HistoryController::class, 'all'])->middleware('throttle:dbsuperb-api')->name('api.history.all');

    Route::prefix('api/c/{connection}')->name('api.')->middleware('throttle:dbsuperb-api')->group(function () {
        Route::get('schema', [SchemaController::class, 'show'])->name('schema.show');
        Route::post('schema/refresh', [SchemaController::class, 'refresh'])->name('schema.refresh');
        Route::get('layout', [LayoutController::class, 'show'])->name('layout.show');
        Route::put('layout', [LayoutController::class, 'update'])->name('layout.update');
        Route::get('tables/{table}/sample', [TableController::class, 'sample'])->where('table', '.+')->name('tables.sample');
        Route::get('tables/{table}/ddl', [TableController::class, 'ddl'])->where('table', '.+')->name('tables.ddl');
        Route::post('tables/{table}/rows', TableRowsController::class)->where('table', '.+')->name('tables.rows');
        Route::post('query', [QueryController::class, 'run'])->name('query.run');
        Route::post('query/explain', [QueryController::class, 'explain'])->name('query.explain');
        Route::get('history', [HistoryController::class, 'index'])->name('history.index');
        Route::delete('history', [HistoryController::class, 'clear'])->name('history.clear');
        Route::get('history/{entry}', [HistoryController::class, 'show'])->whereNumber('entry')->name('history.show');
    });
});

require __DIR__.'/settings.php';
