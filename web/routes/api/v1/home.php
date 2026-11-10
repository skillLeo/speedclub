<?php

use App\Http\Controllers\Api\V1\Discover\HomeController;
use App\Http\Controllers\Api\V1\Home\FeedController;
use Illuminate\Support\Facades\Route;

// HOME-01. Guests included, so no `member`: App\Support\Viewer reads a token if there is one (ADR-124: no session for guests).
// throttle:browse: 300/min per member or guest IP, and 1200/min per IP over everybody behind it (RateLimits).
Route::prefix('home')->name('home.')->middleware(['throttle:browse', 'etag'])->group(function (): void {
    Route::get('featured', [HomeController::class, 'featured'])->name('featured');
    Route::get('new-builds', [HomeController::class, 'newBuilds'])->name('new-builds');
    Route::get('modules', [HomeController::class, 'modules'])->name('modules');
});

// M2.2: tab=for_you takes guests; tab=following answers a guest 401 (FeedRequest).
Route::get('feed', FeedController::class)->middleware(['throttle:browse', 'etag'])->name('feed');
