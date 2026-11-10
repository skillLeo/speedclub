<?php

use App\Http\Controllers\Admin\Audit\AuditExportController;
use App\Http\Controllers\Admin\Audit\AuditLogController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-44. The export is four-eyes: the POST only creates an approval request (ADR-214), after a recent password (ADR-215).
Route::middleware(AdminRoutes::signedIn())->prefix('audit')->name('audit.')->group(function (): void {
    Route::get('/', AuditLogController::class)->middleware('can:audit.view')->name('index');
    Route::post('export', AuditExportController::class)->middleware(['can:audit.export', 'staff.recent-password', 'throttle:10,1'])->name('export');
});
