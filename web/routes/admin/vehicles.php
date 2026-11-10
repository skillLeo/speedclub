<?php

use App\Http\Controllers\Admin\Support\AdminRoutes;
use App\Http\Controllers\Admin\Vehicles\VehicleActionsController;
use App\Http\Controllers\Admin\Vehicles\VehiclesBulkController;
use App\Http\Controllers\Admin\Vehicles\VehicleShowController;
use App\Http\Controllers\Admin\Vehicles\VehiclesIndexController;
use Illuminate\Support\Facades\Route;

// ADM-11/12 (m3.2-contract §2): every route needs vehicles.view; the writes add their atom (FormRequest) and a recent password.
Route::middleware([...AdminRoutes::signedIn(), 'can:vehicles.view'])->prefix('vehicles')->name('vehicles.')->group(function (): void {
    Route::get('/', VehiclesIndexController::class)->name('index');
    Route::post('bulk-hide', VehiclesBulkController::class)->middleware(['can:vehicles.hide', 'staff.recent-password', 'throttle:20,1'])->name('bulk-hide');

    Route::get('{vehicle}', VehicleShowController::class)->whereUlid('vehicle')->withTrashed()->name('show');

    Route::middleware('throttle:60,1')->whereUlid('vehicle')->group(function (): void {
        Route::patch('{vehicle}', [VehicleActionsController::class, 'update'])->middleware(['can:vehicles.edit', 'staff.recent-password'])->name('update');
        Route::post('{vehicle}/hide', [VehicleActionsController::class, 'hide'])->middleware(['can:vehicles.hide', 'staff.recent-password'])->name('hide');
        Route::post('{vehicle}/unhide', [VehicleActionsController::class, 'unhide'])->middleware(['can:vehicles.hide', 'staff.recent-password'])->name('unhide');
        Route::delete('{vehicle}', [VehicleActionsController::class, 'destroy'])->middleware(['can:vehicles.delete', 'staff.recent-password'])->name('destroy');
    });
});
