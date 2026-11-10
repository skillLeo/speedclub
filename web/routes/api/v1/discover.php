<?php

use App\Http\Controllers\Api\V1\Discover\CatalogPageController;
use App\Http\Controllers\Api\V1\Discover\DiscoverController;
use App\Http\Controllers\Api\V1\Discover\SearchController;
use App\Http\Controllers\Api\V1\Discover\SimilarBuildsController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

// DISC-01 to DISC-04 and the VEH-01 strip "Ähnliche Builds". Guests included (ADR-124). Search counts per member or guest IP
// (throttle:search, 60/min) on top of throttle:browse, 300/min per member or guest IP and 1200/min per IP over everybody behind it.
Route::middleware(['throttle:browse', 'etag'])->group(function (): void {
    Route::get('discover', [DiscoverController::class, 'index'])->name('discover');

    // M2.3 make and model pages. {model} is "{make}--{model}" ("bmw--m4"): model slugs repeat across makes (ModelKey).
    Route::prefix('discover')->name('discover.')->group(function (): void {
        Route::get('makes/{make}', [CatalogPageController::class, 'make'])->name('makes.show');
        Route::get('models/{model}', [CatalogPageController::class, 'model'])->name('models.show');
        Route::get('models/{model}/builds', [CatalogPageController::class, 'builds'])->name('models.builds');
        Route::get('models/{model}/wheel-setups', [CatalogPageController::class, 'wheelSetups'])->name('models.wheel-setups');
    });

    // [SIG sig.similar_builds]: 404 feature_disabled while off.
    Route::get('vehicles/{id}/similar', SimilarBuildsController::class)
        ->middleware(EnsureFeatureEnabled::class.':sig.similar_builds')
        ->name('vehicles.similar');

    Route::prefix('search')->name('search')->middleware('throttle:search')->group(function (): void {
        Route::get('/', [SearchController::class, 'index']);
        Route::get('vehicles', [SearchController::class, 'vehicles'])->name('.vehicles');
        Route::get('users', [SearchController::class, 'users'])->name('.users');
        Route::get('facets', [SearchController::class, 'facets'])->name('.facets');
        Route::get('interpret', [SearchController::class, 'interpret'])->name('.interpret');
    });
});
