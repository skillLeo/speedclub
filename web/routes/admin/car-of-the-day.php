<?php

use App\Http\Controllers\Admin\CarOfTheDay\CarOfTheDayActionsController;
use App\Http\Controllers\Admin\CarOfTheDay\CarOfTheDayIndexController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-64 Car of the Day (M5.9d admin, m5.9d contract §3, ADR-510/513) under Marke & Inhalte, the atoms of the Home curation (06 §3):
// content.view reads, content.edit overrides or skips a day (on the route ahead of the password check, so a role without it hears 403,
// in the FormRequest and in the Action). ⚿ = staff.recent-password (ADR-215). No four-eyes. {day} is a Berlin date (Y-m-d).
Route::middleware([...AdminRoutes::signedIn(), 'can:content.view'])->prefix('content/car-of-the-day')->name('car-of-the-day.')->group(function (): void {
    Route::get('/', CarOfTheDayIndexController::class)->name('index');

    Route::middleware(['can:content.edit', 'staff.recent-password', 'throttle:30,1,admin-car-of-the-day-1'])->where(['day' => '\d{4}-\d{2}-\d{2}'])->group(function (): void {
        Route::post('{day}/override', [CarOfTheDayActionsController::class, 'override'])->name('override');
        Route::post('{day}/skip', [CarOfTheDayActionsController::class, 'skip'])->name('skip');
    });
});
