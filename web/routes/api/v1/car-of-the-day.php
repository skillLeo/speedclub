<?php

use App\Http\Controllers\Api\V1\CarOfTheDay\CarOfTheDayVoteController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

// R4-2.1 Car of the Day voting (docs/reports/round-4/contract-cotd-voting.md), flag cotd_voting: 404 feature_disabled while off, a guest
// hears 401 first. The POST answers suspensions and publishing restrictions with 403 account_restricted (not-restricted:publishing).
Route::prefix('car-of-the-day')->name('car-of-the-day.')->middleware(['member', EnsureFeatureEnabled::class.':cotd_voting'])->group(function (): void {
    Route::get('vote', [CarOfTheDayVoteController::class, 'show'])->middleware(['throttle:browse', 'etag'])->name('vote.show');
    Route::post('vote', [CarOfTheDayVoteController::class, 'store'])->middleware(['not-restricted:publishing', 'throttle:cotd-votes', 'idempotent'])->name('vote.store');
});
