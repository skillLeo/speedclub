<?php

use App\Http\Controllers\Admin\Alerts\AlertsController;
use App\Http\Controllers\Admin\Dashboard\DashboardController;
use App\Http\Controllers\Admin\SavedViews\SavedViewController;
use App\Http\Controllers\Admin\Search\SearchController;
use App\Http\Controllers\Admin\Search\SearchSuggestController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// Overview (ADM-06…08). Every staff member with TOTP reaches them; each section only shows what the staff member's atoms allow.
Route::middleware(AdminRoutes::signedIn())->group(function (): void {
    Route::get('/', DashboardController::class)->name('dashboard');
    Route::get('search', SearchController::class)->middleware('throttle:60,1')->name('search');
    Route::get('search/suggest', SearchSuggestController::class)->middleware('throttle:120,1')->name('search.suggest');
    Route::get('alerts', AlertsController::class)->name('alerts');

    // Personal saved views of any DataTable (contract §2.3). Presets live in the page code.
    Route::post('saved-views', [SavedViewController::class, 'store'])->middleware('throttle:30,1')->name('saved-views.store');
    Route::delete('saved-views/{view}', [SavedViewController::class, 'destroy'])->name('saved-views.destroy');
});
