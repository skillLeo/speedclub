<?php

use App\Http\Controllers\Api\V1\Garage\ModificationController;
use Illuminate\Support\Facades\Route;

Route::middleware('member')->group(function (): void {
    Route::get('vehicles/{vehicle}/mods', [ModificationController::class, 'index'])->name('vehicles.mods.index');
    Route::post('vehicles/{vehicle}/mods', [ModificationController::class, 'store'])
        ->middleware(['not-restricted:publishing', 'throttle:garage-writes', 'idempotent'])
        ->name('vehicles.mods.store');
    Route::put('vehicles/{vehicle}/mods/order', [ModificationController::class, 'reorder'])
        ->middleware(['not-restricted:publishing', 'throttle:garage-reorders'])
        ->name('vehicles.mods.order');

    Route::get('mods/{modification}', [ModificationController::class, 'show'])->name('mods.show');
    Route::patch('mods/{modification}', [ModificationController::class, 'update'])->middleware(['not-restricted:publishing', 'throttle:garage-edits'])->name('mods.update');
    // Stays open under a restriction: a member can always take their own content down.
    Route::delete('mods/{modification}', [ModificationController::class, 'destroy'])->middleware('throttle:garage-edits')->name('mods.destroy');

    Route::post('mods/{modification}/media', [ModificationController::class, 'uploadPhoto'])
        ->middleware(['not-restricted:publishing', 'throttle:uploads', 'idempotent'])
        ->name('mods.media.store');
});
