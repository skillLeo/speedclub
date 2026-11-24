<?php

use App\Http\Controllers\Admin\Insights\InsightsOverviewController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-70 Insights overview (10 §11, m5.7-contract §9): platform totals of views, sticker scans, weekly recaps, plan prompts and pushes
// the weekly engagement cap dropped. content.view reads; there is nothing to write.
Route::middleware([...AdminRoutes::signedIn(), 'can:content.view'])->group(function (): void {
    Route::get('insights', InsightsOverviewController::class)->name('insights.overview');
});
