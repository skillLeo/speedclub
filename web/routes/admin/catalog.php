<?php

use App\Http\Controllers\Admin\Catalog\BrandsController;
use App\Http\Controllers\Admin\Catalog\CatalogExportController;
use App\Http\Controllers\Admin\Catalog\CatalogRequestsController;
use App\Http\Controllers\Admin\Catalog\EntriesController;
use App\Http\Controllers\Admin\Catalog\ImportController;
use App\Http\Controllers\Admin\Catalog\MakesController;
use App\Http\Controllers\Admin\Catalog\ModCategoriesController;
use App\Http\Controllers\Admin\Catalog\ModFieldsController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-14…17 (m3.3-contract §2). Every route needs catalog.view; each write adds catalog.manage (ADM-17: catalog.import) on the route,
// ahead of the password check, so a role without it hears 403 rather than a password prompt, and again in its FormRequest and Action.
// ⚿ = staff.recent-password (ADR-215) on merges, deletes and the import apply; the other writes are reversible, versioned or audited edits
// (allow-listed with their reasons in tests/Feature/Admin/M32/RecentPasswordRoutesTest.php). Merges over 100 affected vehicles and imports
// over 100 changed rows only create the approval (ADR-214/229, inside the Actions). List CSVs need lists.export (ADR-232).
$levels = 'make|model|generation|brand';
$ulid = '[0-9A-Za-z]{26}';

Route::middleware([...AdminRoutes::signedIn(), 'can:catalog.view'])->prefix('catalog')->name('catalog.')->group(function () use ($levels, $ulid): void {
    // ADM-14 makes → models → generations, and the member requests.
    Route::get('makes', [MakesController::class, 'index'])->name('vehicles.makes');
    Route::get('makes/{make}', [MakesController::class, 'show'])->whereNumber('make')->name('vehicles.make');
    Route::get('models/{model}', [MakesController::class, 'model'])->whereNumber('model')->name('vehicles.model');
    Route::get('requests', [CatalogRequestsController::class, 'index'])->name('vehicles.requests');
    Route::get('requests/options', [CatalogRequestsController::class, 'options'])->middleware('can:catalog.manage')->name('vehicles.requests.options');

    // ADM-16 brands.
    Route::get('brands', [BrandsController::class, 'index'])->name('brands');

    // ADM-15 mod categories and their field schema.
    Route::get('mod-categories', [ModCategoriesController::class, 'index'])->name('categories');
    Route::get('mod-categories/{category}', [ModCategoriesController::class, 'show'])->whereNumber('category')->name('categories.show');

    // ADM-17 import, templates; CSV of the catalogue.
    Route::get('import', [ImportController::class, 'index'])->middleware('can:catalog.import')->name('import');
    Route::get('import/{import}', [ImportController::class, 'show'])->middleware('can:catalog.import')->where('import', $ulid)->name('import.show');
    Route::get('import/template/{kind}.csv', [ImportController::class, 'template'])->middleware(['can:catalog.import', 'throttle:20,1'])->where('kind', '[a-z]{1,20}')->name('import.template');
    Route::get('export/{kind}.csv', CatalogExportController::class)->middleware(['can:lists.export', 'throttle:10,1'])->where('kind', '[a-z]{1,20}')->name('export');

    // What a merge or delete would touch (JSON for the dialogs).
    Route::get('entries/{level}/{id}/impact', [EntriesController::class, 'impact'])->whereIn('level', explode('|', $levels))->whereNumber('id')->name('entries.impact');

    Route::middleware(['can:catalog.manage', 'throttle:60,1'])->group(function () use ($levels, $ulid): void {
        Route::post('entries/{level}', [EntriesController::class, 'store'])->whereIn('level', explode('|', $levels))->name('entries.store');
        Route::patch('entries/{level}/{id}', [EntriesController::class, 'update'])->whereIn('level', explode('|', $levels))->whereNumber('id')->name('entries.update');
        Route::post('entries/{level}/{id}/active', [EntriesController::class, 'active'])->whereIn('level', ['make', 'model', 'generation'])->whereNumber('id')->name('entries.active');
        Route::post('entries/{level}/{id}/merge', [EntriesController::class, 'merge'])->middleware('staff.recent-password')->whereIn('level', explode('|', $levels))->whereNumber('id')->name('entries.merge');
        Route::delete('entries/{level}/{id}', [EntriesController::class, 'destroy'])->middleware('staff.recent-password')->whereIn('level', explode('|', $levels))->whereNumber('id')->name('entries.destroy');

        Route::post('requests/{catalogRequest}/accept', [CatalogRequestsController::class, 'accept'])->where('catalogRequest', $ulid)->name('vehicles.requests.accept');
        Route::post('requests/{catalogRequest}/reject', [CatalogRequestsController::class, 'reject'])->where('catalogRequest', $ulid)->name('vehicles.requests.reject');

        Route::post('mod-categories', [ModCategoriesController::class, 'store'])->name('categories.store');
        Route::patch('mod-categories/{category}', [ModCategoriesController::class, 'update'])->whereNumber('category')->name('categories.update');
        Route::post('mod-categories/{category}/fields', [ModFieldsController::class, 'store'])->whereNumber('category')->name('fields.store');
        Route::post('mod-categories/{category}/fields/order', [ModFieldsController::class, 'reorder'])->whereNumber('category')->name('fields.reorder');
        Route::patch('mod-fields/{field}', [ModFieldsController::class, 'update'])->whereNumber('field')->name('fields.update');
        Route::post('mod-fields/{field}/archive', [ModFieldsController::class, 'archive'])->whereNumber('field')->name('fields.archive');
        Route::delete('mod-fields/{field}', [ModFieldsController::class, 'destroy'])->middleware('staff.recent-password')->whereNumber('field')->name('fields.destroy');
    });

    Route::middleware(['can:catalog.import', 'throttle:20,1'])->group(function () use ($ulid): void {
        Route::post('import', [ImportController::class, 'store'])->name('import.store');
        Route::post('import/{import}/apply', [ImportController::class, 'apply'])->middleware(['can:catalog.manage', 'staff.recent-password'])->where('import', $ulid)->name('import.apply');
    });
});
