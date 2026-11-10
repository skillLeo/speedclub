<?php

use App\Http\Controllers\Api\V1\Social\BlockController;
use App\Http\Controllers\Api\V1\Social\FollowController;
use App\Http\Controllers\Api\V1\Social\SaveController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

Route::middleware(['member', 'verified-member'])->group(function (): void {
    Route::post('users/{username}/follow', [FollowController::class, 'store'])->middleware('throttle:follows')->name('follows.store');
    Route::delete('users/{username}/follow', [FollowController::class, 'destroy'])->middleware('throttle:unfollows')->name('follows.destroy');
});

// A safety tool: open to unverified and restricted members (BlockPolicy), so `member` without verified-member.
Route::middleware('member')->group(function (): void {
    Route::post('users/{username}/block', [BlockController::class, 'store'])->middleware(['throttle:blocks', 'idempotent'])->name('blocks.store');
    Route::delete('users/{username}/block', [BlockController::class, 'destroy'])->middleware('throttle:blocks')->name('blocks.destroy');
});

// [SIG sig.saved_builds]: 404 feature_disabled while the flag is off. A guest hears 401 first, as on every member route. No verification
// needed (ADR-139).
Route::middleware(['member', EnsureFeatureEnabled::class.':sig.saved_builds'])->group(function (): void {
    Route::post('vehicles/{vehicle}/save', [SaveController::class, 'store'])->middleware(['throttle:saves', 'idempotent'])->name('saves.store');
    Route::delete('vehicles/{vehicle}/save', [SaveController::class, 'destroy'])->middleware('throttle:saves')->name('saves.destroy');
});
