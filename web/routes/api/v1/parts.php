<?php

use App\Http\Controllers\Api\V1\Parts\BrandPageController;
use App\Http\Controllers\Api\V1\Parts\ProductController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

// M4.14 parts catalogue (09 §8.9, §11 "catalogue"): BRD-01/02, product search and "Builds mit {Produkt}". Flag `parts_catalogue` on
// every route (404 feature_disabled while off). Guests too (ADR-124), read through App\Support\Viewer. `catalog/brands` (the editor's
// brand list) stays as it is.
$slug = '[a-z0-9-]{1,140}';
$ulid = '[0-9A-Za-z]{26}';

Route::middleware([EnsureFeatureEnabled::class.':parts_catalogue', 'throttle:browse', 'etag'])->group(function () use ($slug, $ulid): void {
    Route::get('brands', [BrandPageController::class, 'index'])->name('brands.index');
    Route::get('brands/{slug}', [BrandPageController::class, 'show'])->where('slug', $slug)->name('brands.show');
    Route::get('brands/{slug}/products', [BrandPageController::class, 'products'])->where('slug', $slug)->name('brands.products');
    Route::get('brands/{slug}/builds', [BrandPageController::class, 'builds'])->where('slug', $slug)->name('brands.builds');

    Route::get('products', [ProductController::class, 'index'])->name('products.index');
    Route::get('products/{product}', [ProductController::class, 'show'])->where('product', $ulid)->name('products.show');
    Route::get('products/{product}/builds', [ProductController::class, 'builds'])->where('product', $ulid)->name('products.builds');
});
