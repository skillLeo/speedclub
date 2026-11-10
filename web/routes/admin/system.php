<?php

use App\Http\Controllers\Admin\Support\AdminRoutes;
use App\Http\Controllers\Admin\System\HealthController;
use App\Http\Controllers\Admin\System\IntegrationsController;
use App\Http\Controllers\Admin\System\JobsController;
use Illuminate\Support\Facades\Route;

// ADM-48…50 (m3.6-contract §2). Health and jobs need system.view, retry/forget system.jobs, integrations integrations.view. Nothing here
// ever shows a secret, a payload or a message (06 §3 System). Retry/forget need a recent password (ADR-215); running the checks and the
// integration tests change nothing (a test goes to the staff member themselves).
Route::middleware(AdminRoutes::signedIn())->prefix('system')->name('system.')->group(function (): void {
    Route::middleware('can:system.view')->group(function (): void {
        Route::get('health', [HealthController::class, 'show'])->name('health');
        Route::post('health/run', [HealthController::class, 'run'])->middleware('throttle:6,1')->name('health.run');
        Route::get('jobs', [JobsController::class, 'index'])->name('jobs');
        Route::post('jobs/retry', [JobsController::class, 'retry'])->middleware(['can:system.jobs', 'staff.recent-password', 'throttle:20,1'])->name('jobs.retry');
        Route::post('jobs/forget', [JobsController::class, 'forget'])->middleware(['can:system.jobs', 'staff.recent-password', 'throttle:20,1'])->name('jobs.forget');
    });

    Route::middleware('can:integrations.view')->group(function (): void {
        Route::get('integrations', [IntegrationsController::class, 'index'])->name('integrations');
        Route::post('integrations/{integration}/test', [IntegrationsController::class, 'test'])->whereIn('integration', ['mail', 'pusher', 'push', 'ai'])->middleware('throttle:6,1')->name('integrations.test');
    });
});
