<?php

use App\Http\Controllers\Admin\Shop\ShopBannersController;
use App\Http\Controllers\Admin\Shop\ShopProductImagesController;
use App\Http\Controllers\Admin\Shop\ShopProductsController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-66 Shop-Produkte and ADM-67 Shop-Banner (10 §3, m5.5-contract §5; the Vue pages come from admin-builder). Atom shop.manage on every
// route (and in every FormRequest). ⚿ = staff.recent-password (ADR-215) on the two irreversible writes, the deletes; every other write
// is reversible and audited (RecentPasswordRoutesTest lists each with its reason). No four-eyes (06 §2 list).
$ulid = '[0-9A-Za-z]{26}';

Route::middleware([...AdminRoutes::signedIn(), 'can:shop.manage'])->prefix('shop')->name('shop.')->group(function () use ($ulid): void {
    Route::get('products', [ShopProductsController::class, 'index'])->name('products.index');
    Route::get('products/new', [ShopProductsController::class, 'create'])->name('products.create');
    Route::get('products/{product}', [ShopProductsController::class, 'edit'])->where('product', $ulid)->name('products.edit');
    Route::get('banners', [ShopBannersController::class, 'index'])->name('banners.index');

    Route::middleware('throttle:60,1,admin-shop-1')->group(function () use ($ulid): void {
        Route::post('products', [ShopProductsController::class, 'store'])->name('products.store');
        Route::post('products/reorder', [ShopProductsController::class, 'reorder'])->name('products.reorder');
        Route::patch('products/{product}', [ShopProductsController::class, 'update'])->where('product', $ulid)->name('products.update');
        Route::post('products/{product}/visibility', [ShopProductsController::class, 'visibility'])->where('product', $ulid)->name('products.visibility');
        Route::post('products/{product}/restore', [ShopProductsController::class, 'restore'])->where('product', $ulid)->name('products.restore');
        Route::delete('products/{product}', [ShopProductsController::class, 'destroy'])->where('product', $ulid)->middleware('staff.recent-password')->name('products.destroy');

        Route::patch('products/{product}/images/{image}', [ShopProductImagesController::class, 'update'])->where(['product' => $ulid, 'image' => $ulid])->name('products.images.update');
        Route::post('products/{product}/images/reorder', [ShopProductImagesController::class, 'reorder'])->where('product', $ulid)->name('products.images.reorder');
        Route::delete('products/{product}/images/{image}', [ShopProductImagesController::class, 'destroy'])->where(['product' => $ulid, 'image' => $ulid])->name('products.images.destroy');

        Route::patch('banners/{banner}', [ShopBannersController::class, 'update'])->where('banner', $ulid)->name('banners.update');
        Route::post('banners/{banner}/activate', [ShopBannersController::class, 'activate'])->where('banner', $ulid)->name('banners.activate');
        Route::post('banners/{banner}/deactivate', [ShopBannersController::class, 'deactivate'])->where('banner', $ulid)->name('banners.deactivate');
        Route::delete('banners/{banner}', [ShopBannersController::class, 'destroy'])->where('banner', $ulid)->middleware('staff.recent-password')->name('banners.destroy');
    });

    // Uploads: GD re-encodes up to 12 MP, so fewer per minute.
    Route::middleware('throttle:30,1,admin-shop-2')->group(function () use ($ulid): void {
        Route::post('products/{product}/images', [ShopProductImagesController::class, 'store'])->where('product', $ulid)->name('products.images.store');
        Route::post('banners', [ShopBannersController::class, 'store'])->name('banners.store');
    });
});
