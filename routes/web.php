<?php

use App\Http\Controllers\Api\DatabaseController;
use App\Http\Controllers\Api\HistoryController;
use App\Http\Controllers\Api\LayoutController;
use App\Http\Controllers\Api\PinController;
use App\Http\Controllers\Api\QueryController;
use App\Http\Controllers\Api\RecordController;
use App\Http\Controllers\Api\SchemaController;
use App\Http\Controllers\Api\TableChangesController;
use App\Http\Controllers\Api\TableController;
use App\Http\Controllers\Api\TableCountController;
use App\Http\Controllers\Api\TableRowsController;
use App\Http\Controllers\ConnectionController;
use App\Http\Controllers\ConnectionTestController;
use App\Http\Controllers\HistoryPageController;
use App\Http\Controllers\SetupController;
use App\Http\Controllers\WorkspaceController;
use App\Http\Middleware\RequireDatabase;
use Illuminate\Support\Facades\Route;

Route::get('setup', [SetupController::class, 'show'])->name('setup.show');
Route::post('setup', [SetupController::class, 'store'])->middleware('throttle:10,1')->name('setup.store');

Route::middleware('auth')->group(function () {
    Route::redirect('/', '/connections')->name('home');
    Route::redirect('dashboard', '/connections')->name('dashboard');
    Route::post('connections/test', ConnectionTestController::class)
        ->middleware('throttle:dbzuper-api')->name('connections.test');
    Route::resource('connections', ConnectionController::class)->except('show')->where(['connection' => '[0-9]+']);

    Route::get('c/{connection}/{database?}', WorkspaceController::class)->where(['connection' => '[0-9]+', 'database' => '[^/]+'])->name('workspace.show');

    Route::get('history', HistoryPageController::class)->name('history.index');
    Route::get('api/history', [HistoryController::class, 'all'])->middleware('throttle:dbzuper-api')->name('api.history.all');

    Route::get('api/c/{connection}/databases', DatabaseController::class)
        ->middleware('throttle:dbzuper-api')->name('api.databases.index');

    Route::prefix('api/c/{connection}')->name('api.')->middleware(['throttle:dbzuper-api', RequireDatabase::class])->group(function () {
        Route::get('schema', [SchemaController::class, 'show'])->name('schema.show');
        Route::post('schema/refresh', [SchemaController::class, 'refresh'])->name('schema.refresh');
        Route::get('layout', [LayoutController::class, 'show'])->name('layout.show');
        Route::put('layout', [LayoutController::class, 'update'])->name('layout.update');
        Route::get('pins', [PinController::class, 'index'])->name('pins.index');
        Route::post('pins', [PinController::class, 'store'])->name('pins.store');
        Route::put('pins/order', [PinController::class, 'reorder'])->name('pins.order');
        Route::delete('pins/{pin}', [PinController::class, 'destroy'])->whereNumber('pin')->name('pins.destroy');
        Route::get('tables/{table}/sample', [TableController::class, 'sample'])->where('table', '.+')->name('tables.sample');
        Route::get('tables/{table}/ddl', [TableController::class, 'ddl'])->where('table', '.+')->name('tables.ddl');
        Route::post('tables/{table}/rows', TableRowsController::class)->where('table', '.+')->name('tables.rows');
        Route::post('tables/{table}/count', TableCountController::class)->where('table', '.+')->name('tables.count');
        Route::post('tables/{table}/changes', TableChangesController::class)->where('table', '.+')->name('tables.changes');
        Route::post('query', [QueryController::class, 'run'])->name('query.run');
        Route::post('query/explain', [QueryController::class, 'explain'])->name('query.explain');
        Route::get('history', [HistoryController::class, 'index'])->name('history.index');
        Route::delete('history', [HistoryController::class, 'clear'])->name('history.clear');
        Route::get('history/{entry}', [HistoryController::class, 'show'])->whereNumber('entry')->name('history.show');
        // Record reads use their own, higher limit instead of the group's dbzuper-api limit.
        Route::withoutMiddleware('throttle:dbzuper-api')->middleware('throttle:dbzuper-records')->group(function () {
            Route::get('records/{table}/related', [RecordController::class, 'related'])->where('table', '.+')->name('records.related');
            Route::get('records/{table}', [RecordController::class, 'show'])->where('table', '.+')->name('records.show');
        });
    });
});

require __DIR__.'/settings.php';
