<?php

use App\Http\Controllers\Admin\Privacy\PrivacyRequestActionsController;
use App\Http\Controllers\Admin\Privacy\PrivacyRequestsController;
use App\Http\Controllers\Admin\Privacy\PrivacyRequestShowController;
use App\Http\Controllers\Admin\Privacy\RetentionController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-45…47 (m3.6-contract §2). The requests need privacy.view, every step on them privacy.process and a recent password (ADR-215; the
// erasure also members.delete, and it only asks for the four-eyes `members.delete`, ADR-239). Retention: privacy.view to read,
// retention.manage and a recent password to change.
$ulid = '[0-9A-Za-z]{26}';

Route::middleware(AdminRoutes::signedIn())->prefix('privacy')->name('privacy.')->group(function () use ($ulid): void {
    Route::middleware('can:privacy.view')->group(function () use ($ulid): void {
        Route::get('requests', [PrivacyRequestsController::class, 'index'])->name('requests');
        Route::get('requests/{privacyRequest}', PrivacyRequestShowController::class)->where('privacyRequest', $ulid)->name('requests.show');
        Route::get('requests/{privacyRequest}/evidence', [PrivacyRequestActionsController::class, 'evidence'])->where('privacyRequest', $ulid)->middleware('throttle:20,1')->name('requests.evidence');
        Route::get('retention', [RetentionController::class, 'show'])->name('retention');
    });

    Route::middleware(['can:privacy.process', 'staff.recent-password', 'throttle:60,1'])->group(function () use ($ulid): void {
        Route::post('requests', [PrivacyRequestsController::class, 'store'])->name('requests.store');
        Route::patch('requests/{privacyRequest}', [PrivacyRequestActionsController::class, 'update'])->where('privacyRequest', $ulid)->name('requests.update');
        Route::post('requests/{privacyRequest}/extend', [PrivacyRequestActionsController::class, 'extend'])->where('privacyRequest', $ulid)->name('requests.extend');
        Route::post('requests/{privacyRequest}/reply', [PrivacyRequestActionsController::class, 'reply'])->where('privacyRequest', $ulid)->name('requests.reply');
        Route::post('requests/{privacyRequest}/export', [PrivacyRequestActionsController::class, 'export'])->where('privacyRequest', $ulid)->name('requests.export');
        Route::post('requests/{privacyRequest}/erasure', [PrivacyRequestActionsController::class, 'erasure'])->where('privacyRequest', $ulid)->middleware('can:members.delete')->name('requests.erasure');
        Route::post('requests/{privacyRequest}/complete', [PrivacyRequestActionsController::class, 'complete'])->where('privacyRequest', $ulid)->name('requests.complete');
    });

    Route::patch('retention', [RetentionController::class, 'update'])->middleware(['can:retention.manage', 'staff.recent-password', 'throttle:20,1'])->name('retention.update');
});
