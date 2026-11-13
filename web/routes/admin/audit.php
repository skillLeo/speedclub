<?php

use App\Http\Controllers\Admin\Audit\AuditExportController;
use App\Http\Controllers\Admin\Audit\AuditLogController;
use App\Http\Controllers\Admin\Audit\AuditPageCheckController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-44. The export is four-eyes: the POST only creates an approval request (ADR-214), after a recent password (ADR-215).
Route::middleware(AdminRoutes::signedIn())->prefix('audit')->name('audit.')->group(function (): void {
    Route::get('/', AuditLogController::class)->middleware('can:audit.view')->name('index');
    // M4.17: hash check of the events on one page of the log (09 §10.2), read-only JSON.
    Route::get('verify-page', AuditPageCheckController::class)->middleware(['can:audit.view', 'throttle:30,1'])->name('verify-page');
    Route::post('export', AuditExportController::class)->middleware(['can:audit.export', 'staff.recent-password', 'throttle:10,1'])->name('export');
});
