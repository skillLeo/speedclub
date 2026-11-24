<?php

use App\Http\Controllers\Api\V1\Wrapped\WrappedController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

// M5.9e Season Wrapped (10 §16.5, docs/reports/phase-5/m5.9e-contract.md §5). The member's own Wrapped only. Flag `wrapped` on every
// route (404 feature_disabled when off, after `member` so a guest hears 401 first). The season key (`YYYY-saison|YYYY-jahr`) and the
// card position are checked by the FormRequests (422), not by route patterns, so a guest gets 401 before any lookup.
Route::middleware(['member', EnsureFeatureEnabled::class.':wrapped'])->group(function (): void {
    Route::get('me/wrapped', [WrappedController::class, 'index'])->middleware('etag')->name('me.wrapped.index');
    Route::get('me/wrapped/{season_key}', [WrappedController::class, 'show'])->name('me.wrapped.show');
    // Sharing is publishing: refused under a publishing restriction; the counter is idempotent and limited.
    Route::post('me/wrapped/{season_key}/shared', [WrappedController::class, 'shared'])
        ->middleware(['not-restricted:publishing', 'throttle:wrapped', 'idempotent'])
        ->name('me.wrapped.shared');
    Route::get('me/wrapped/{season_key}/cards/{n}.png', [WrappedController::class, 'card'])
        ->middleware('throttle:wrapped')
        ->name('me.wrapped.card');
});
