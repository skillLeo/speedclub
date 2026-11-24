<?php

use App\Http\Controllers\Api\V1\Me\PlateCheckController;
use Illuminate\Support\Facades\Route;

// M5.9a "Kennzeichen prüfen" (m5.9a-contract §4). The decisions are edits of the member's own photos: under a publishing restriction,
// like PATCH media/{media}, and on the garage-edits limiter.
Route::prefix('me/plate-check')->name('me.plate-check.')->middleware('member')->group(function (): void {
    Route::get('/', [PlateCheckController::class, 'index'])->name('index');
    // Before {media}, so "dismiss" is never read as a media id.
    Route::post('dismiss', [PlateCheckController::class, 'dismiss'])
        ->middleware(['not-restricted:publishing', 'throttle:garage-edits', 'idempotent'])
        ->name('dismiss');
    Route::post('{media}', [PlateCheckController::class, 'decide'])
        ->where('media', '[0-9A-Za-z]{26}')
        ->middleware(['not-restricted:publishing', 'throttle:garage-edits', 'idempotent'])
        ->name('decide');
});
