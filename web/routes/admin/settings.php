<?php

use App\Http\Controllers\Admin\Settings\OrgSettingsController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-52 org settings (m3.6 §1): readable with staff.manage (an Admin sees the values read-only), changed only by an Owner, with a reason
// and a recent password (ADR-215); the controller's FormRequest refuses everyone else.
Route::middleware([...AdminRoutes::signedIn(), 'can:staff.manage'])->group(function (): void {
    Route::get('settings', [OrgSettingsController::class, 'show'])->name('settings');
    Route::patch('settings', [OrgSettingsController::class, 'update'])->middleware(['staff.recent-password', 'throttle:20,1'])->name('settings.update');
});
