<?php

use App\Http\Controllers\Admin\Memberships\EnsureMembershipsEnabled;
use App\Http\Controllers\Admin\Memberships\EntitlementsController;
use App\Http\Controllers\Admin\Memberships\PlansController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-F1/F2 (m3.6 §1): the flagged memberships scaffold. While `premium.enabled` is off every route answers 404 to everyone, before the
// atom is asked (EnsureMembershipsEnabled); with it on, memberships.manage. No payment code.
$ulid = '[0-9A-Za-z]{26}';

Route::middleware([...AdminRoutes::signedIn(), EnsureMembershipsEnabled::class, 'can:memberships.manage'])->prefix('memberships')->name('memberships.')->group(function () use ($ulid): void {
    Route::get('plans', [PlansController::class, 'index'])->name('plans');
    Route::get('entitlements', [EntitlementsController::class, 'index'])->name('entitlements');

    Route::middleware(['staff.recent-password', 'throttle:30,1'])->group(function () use ($ulid): void {
        Route::post('plans', [PlansController::class, 'store'])->name('plans.store');
        Route::patch('plans/{plan}', [PlansController::class, 'update'])->where('plan', '[0-9]+')->name('plans.update');
        Route::post('entitlements', [EntitlementsController::class, 'store'])->name('entitlements.store');
        Route::post('entitlements/{entitlement}/revoke', [EntitlementsController::class, 'revoke'])->where('entitlement', $ulid)->name('entitlements.revoke');
    });
});
