<?php

use App\Http\Controllers\Admin\Parts\ProductsController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-57 Teile & Produkte (09 §8.9, §10.3; M4.14 backend, page for the admin-builder round). Every route needs catalog.view; writes add
// catalog.manage on the route (ahead of the password check) and in their FormRequest. ⚿ = staff.recent-password on the merge (as ADM-16
// brand merges). The CSV import is ADM-17's (routes/admin/catalog.php) with the kind `products`.
$ulid = '[0-9A-Za-z]{26}';

Route::middleware([...AdminRoutes::signedIn(), 'can:catalog.view'])->prefix('catalog/products')->name('catalog.products.')->group(function () use ($ulid): void {
    Route::get('/', [ProductsController::class, 'index'])->name('index');
    Route::get('{product}', [ProductsController::class, 'show'])->where('product', $ulid)->name('show');

    Route::middleware(['can:catalog.manage', 'throttle:60,1'])->group(function () use ($ulid): void {
        Route::post('/', [ProductsController::class, 'store'])->name('store');
        Route::patch('{product}', [ProductsController::class, 'update'])->where('product', $ulid)->name('update');
        Route::post('{product}/archive', [ProductsController::class, 'archive'])->where('product', $ulid)->name('archive');
        Route::post('{product}/restore', [ProductsController::class, 'restore'])->where('product', $ulid)->name('restore');
        Route::post('{product}/merge', [ProductsController::class, 'merge'])->where('product', $ulid)->middleware('staff.recent-password')->name('merge');
    });
});
