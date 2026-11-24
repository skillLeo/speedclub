<?php

use App\Http\Controllers\Api\V1\Shop\ShopController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

// M5.5 Shop (10 §3, ADR-502, m5.5-contract §3): SHOP-01/02, flag `shop` on every route (404 feature_disabled while off; the tab itself
// stays, ADR-519). Guests too, read through App\Support\Viewer; one ETag for every reader. {product} is the ULID or the slug.
Route::middleware([EnsureFeatureEnabled::class.':shop', 'throttle:browse', 'etag'])->prefix('shop')->name('shop.')->group(function (): void {
    Route::get('/', [ShopController::class, 'index'])->name('index');
    Route::get('products', [ShopController::class, 'products'])->name('products.index');
    Route::get('products/{product}', [ShopController::class, 'show'])->where('product', '[0-9A-Za-z]{26}|[a-z0-9-]{1,140}')->name('products.show');
});
