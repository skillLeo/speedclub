<?php

use App\Http\Controllers\Api\V1\Insights\InsightsController;
use App\Http\Controllers\Api\V1\Insights\ViewController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

// M5.7 Engagement (10 §6.1, m5.7-contract §3). The beacon takes guests and members (App\Support\Viewer) and always answers 204; with the
// flag `insights` off it records nothing (no 404, so older apps never see an error). INS-01 is the owner's alone.
Route::post('views', [ViewController::class, 'store'])->middleware('throttle:views')->name('views.store');

Route::middleware(['member', EnsureFeatureEnabled::class.':insights', 'throttle:insights'])->group(function (): void {
    // A private copy for 60 s (contract §3.2); `as_of` is the minute, so the ETag also answers 304 within it.
    Route::get('me/insights', [InsightsController::class, 'account'])->middleware('etag:max-age=60')->name('me.insights');
    Route::get('vehicles/{vehicle}/insights', [InsightsController::class, 'vehicle'])->middleware('etag:max-age=60')->name('vehicles.insights');
});
