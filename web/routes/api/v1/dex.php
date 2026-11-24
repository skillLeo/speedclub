<?php

use App\Http\Controllers\Api\V1\Dex\DexCardController;
use App\Http\Controllers\Api\V1\Dex\DexController;
use App\Http\Controllers\Api\V1\Dex\RarityRulesController;
use App\Http\Controllers\Api\V1\Dex\SpotController;
use App\Http\Controllers\Api\V1\Dex\SpotMapController;
use Illuminate\Support\Facades\Route;

// M5.9b STREET DEX (10 §16.2, docs/reports/phase-5/m5.9b-contract.md).
Route::get('rarity-rules', RarityRulesController::class)->middleware(['throttle:public-read', 'etag'])->name('rarity-rules');
// Part 2: the public heat map (city aggregates, cached 1 h).
Route::get('spot-map', SpotMapController::class)->middleware(['throttle:public-read', 'etag'])->name('spot-map');

Route::middleware('member')->group(function (): void {
    // A spot puts the member in front of the car's owner: verified address, no publishing restriction.
    Route::post('spots', [SpotController::class, 'store'])
        ->middleware(['verified-member', 'not-restricted:publishing', 'throttle:spots', 'idempotent'])
        ->name('spots.store');
    Route::get('spots/{spot}', [SpotController::class, 'show'])->name('spots.show');

    Route::get('me/dex', [DexController::class, 'index'])->middleware('etag')->name('me.dex.index');
    Route::get('me/dex/sets', [DexController::class, 'sets'])->middleware('etag')->name('me.dex.sets');

    Route::get('vehicles/{vehicle}/dex-card', [DexCardController::class, 'show'])->middleware('etag')->name('vehicles.dex-card');
    Route::get('vehicles/{vehicle}/spot-stats', [DexCardController::class, 'stats'])->middleware('etag')->name('vehicles.spot-stats');
});
