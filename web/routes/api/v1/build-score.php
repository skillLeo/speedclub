<?php

use App\Http\Controllers\Api\V1\BuildScore\BuildScoreController;
use Illuminate\Support\Facades\Route;

// M5.9c Build Score (10 §16.3, docs/reports/phase-5/m5.9c-contract.md §4). Guests too (ADR-124): the score is public wherever the
// vehicle is; `next_upgrades` only for its owner.
Route::get('build-score/formula', [BuildScoreController::class, 'formula'])->middleware(['throttle:public-read', 'etag'])->name('build-score.formula');
Route::get('vehicles/{vehicle}/build-score', [BuildScoreController::class, 'show'])->middleware(['throttle:browse', 'etag'])->name('vehicles.build-score');
