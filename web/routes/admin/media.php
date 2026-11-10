<?php

use App\Http\Controllers\Admin\Media\MediaActionsController;
use App\Http\Controllers\Admin\Media\MediaOriginalController;
use App\Http\Controllers\Admin\Media\MediaReviewController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-13 (m3.2-contract §2). The queue needs media.review; each action needs its own atom (FormRequest), hiding a recent password.
Route::middleware(AdminRoutes::signedIn())->prefix('media-review')->name('media.')->group(function (): void {
    Route::get('/', MediaReviewController::class)->middleware('can:media.review')->name('index');

    Route::middleware('throttle:120,1')->whereUlid('media')->group(function (): void {
        Route::post('{media}/approve', [MediaActionsController::class, 'approve'])->middleware('can:media.review')->name('approve');
        Route::post('{media}/hide', [MediaActionsController::class, 'hide'])->middleware(['can:media.hide', 'staff.recent-password'])->name('hide');
        Route::post('{media}/unhide', [MediaActionsController::class, 'unhide'])->middleware(['can:media.hide', 'staff.recent-password'])->name('unhide');
        // DQ-532: the private original of a removed photo, for whoever may review it. "Anzeigen" is audited and answers a signed URL
        // (5 minutes); only that URL serves the file (MediaOriginalController).
        Route::post('{media}/original', [MediaOriginalController::class, 'reveal'])->middleware('can:media.review')->name('original');
        Route::get('{media}/original', [MediaOriginalController::class, 'file'])->middleware(['can:media.review', 'signed:relative'])->name('original.file');
    });
});
