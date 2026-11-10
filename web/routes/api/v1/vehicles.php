<?php

use App\Http\Controllers\Api\V1\Garage\BuildUpdateController;
use App\Http\Controllers\Api\V1\Garage\VehicleController;
use Illuminate\Support\Facades\Route;

Route::middleware('member')->group(function (): void {
    Route::get('me/vehicles', [VehicleController::class, 'index'])->name('me.vehicles.index');
    Route::put('me/vehicles/order', [VehicleController::class, 'reorder'])->middleware(['not-restricted:publishing', 'throttle:garage-reorders'])->name('me.vehicles.order');

    Route::post('vehicles', [VehicleController::class, 'store'])
        ->middleware(['not-restricted:publishing', 'throttle:garage-writes', 'idempotent'])
        ->name('vehicles.store');

    Route::get('vehicles/{vehicle}', [VehicleController::class, 'show'])->name('vehicles.show');
    Route::patch('vehicles/{vehicle}', [VehicleController::class, 'update'])->middleware(['not-restricted:publishing', 'throttle:garage-edits'])->name('vehicles.update');
    // Stays open under a restriction: a member can always take their own content down.
    Route::delete('vehicles/{vehicle}', [VehicleController::class, 'destroy'])->middleware('throttle:garage-edits')->name('vehicles.destroy');

    Route::put('vehicles/{vehicle}/specs', [VehicleController::class, 'specs'])->middleware(['not-restricted:publishing', 'throttle:garage-edits'])->name('vehicles.specs');

    Route::post('vehicles/{vehicle}/publish', [VehicleController::class, 'publish'])
        ->middleware(['verified-member', 'not-restricted:publishing', 'throttle:garage-writes', 'idempotent'])
        ->name('vehicles.publish');

    Route::post('vehicles/{vehicle}/main', [VehicleController::class, 'main'])->middleware(['not-restricted:publishing', 'throttle:garage-edits'])->name('vehicles.main');

    // Going private stays open under a restriction, so the controller decides by the value.
    Route::patch('vehicles/{vehicle}/visibility', [VehicleController::class, 'visibility'])->middleware('throttle:garage-edits')->name('vehicles.visibility');

    Route::get('vehicles/{vehicle}/updates', [BuildUpdateController::class, 'index'])->name('vehicles.updates.index');
    Route::post('vehicles/{vehicle}/updates', [BuildUpdateController::class, 'store'])
        ->middleware(['not-restricted:publishing', 'throttle:garage-writes', 'idempotent'])
        ->name('vehicles.updates.store');
    // Hiding stays open under a restriction, like deleting, so the controller decides by the value.
    Route::patch('updates/{update}', [BuildUpdateController::class, 'update'])->middleware('throttle:garage-edits')->name('updates.update');
});
