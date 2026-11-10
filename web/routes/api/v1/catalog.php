<?php

use App\Http\Controllers\Api\V1\Catalog\CatalogController;
use App\Http\Controllers\Api\V1\Catalog\CatalogRequestController;
use Illuminate\Support\Facades\Route;

Route::prefix('catalog')->name('catalog.')->group(function (): void {
    Route::middleware(['throttle:public-read', 'etag'])->group(function (): void {
        Route::get('makes', [CatalogController::class, 'makes'])->name('makes');
        Route::get('makes/{make}/models', [CatalogController::class, 'models'])->whereNumber('make')->name('models');
        Route::get('models/{model}/generations', [CatalogController::class, 'generations'])->whereNumber('model')->name('generations');
        Route::get('brands', [CatalogController::class, 'brands'])->name('brands');
        Route::get('mod-categories', [CatalogController::class, 'modCategories'])->name('mod-categories');
    });

    Route::post('requests', [CatalogRequestController::class, 'store'])
        ->middleware(['member', 'not-restricted:publishing', 'throttle:catalog-requests', 'idempotent'])
        ->name('requests.store');
});
