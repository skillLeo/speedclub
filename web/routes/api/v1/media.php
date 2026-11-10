<?php

use App\Http\Controllers\Api\V1\Media\MediaController;
use Illuminate\Support\Facades\Route;

Route::middleware('member')->group(function (): void {
    Route::post('vehicles/{vehicle}/media', [MediaController::class, 'store'])
        ->middleware(['not-restricted:publishing', 'throttle:uploads', 'idempotent'])
        ->name('vehicles.media.store');

    Route::put('vehicles/{vehicle}/media/order', [MediaController::class, 'reorder'])
        ->middleware(['not-restricted:publishing', 'throttle:garage-reorders'])
        ->name('vehicles.media.order');

    Route::patch('media/{media}', [MediaController::class, 'update'])
        ->middleware(['not-restricted:publishing', 'throttle:garage-edits'])
        ->name('media.update');

    // Stays open under a restriction: a member can always take their own content down.
    Route::delete('media/{media}', [MediaController::class, 'destroy'])->middleware('throttle:garage-edits')->name('media.destroy');
});
