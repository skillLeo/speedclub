<?php

use App\Http\Controllers\Admin\Brand\BrandController;
use App\Http\Controllers\Admin\Config\ConfigDraftController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-28 Marke & Theme (m3.5-contract §2), everything with brand.manage. Uploading and saving the draft change nothing live (allow-listed
// in tests/Feature/Admin/M32/RecentPasswordRoutesTest.php with their reasons); publishing is ⚿ (staff.recent-password, ADR-215).
// Rollbacks of the branding key run from ADM-35 (content.php).
Route::middleware([...AdminRoutes::signedIn(), 'can:brand.manage'])->prefix('brand')->name('brand.')->group(function (): void {
    Route::get('/', [BrandController::class, 'index'])->name('index');
    Route::get('assets/{asset}/contrast', [BrandController::class, 'contrast'])->middleware('throttle:120,1')->where('asset', '[0-9A-Za-z]{26}')->name('assets.contrast');

    Route::middleware('throttle:30,1')->group(function (): void {
        Route::post('assets', [BrandController::class, 'upload'])->name('assets.store');
        Route::post('draft', [ConfigDraftController::class, 'save'])->defaults('key', 'branding')->name('draft.save');
        Route::delete('draft', [ConfigDraftController::class, 'discard'])->defaults('key', 'branding')->name('draft.discard');
        Route::post('publish', [ConfigDraftController::class, 'publish'])->defaults('key', 'branding')->middleware('staff.recent-password')->name('publish');
    });
});
