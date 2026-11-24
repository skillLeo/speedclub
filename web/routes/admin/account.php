<?php

use App\Http\Controllers\Admin\Account\AccountController;
use App\Http\Controllers\Admin\Account\AccountSessionsController;
use App\Http\Controllers\Admin\Account\AccountTwoFactorController;
use App\Http\Controllers\Admin\Account\AccountTwoFactorDisableController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-51 my staff account (every staff member). The password change is Fortify's `user-password.update` (UpdateStaffPassword). The four
// code steps (rotation start/confirm, recovery codes show/regenerate) answer JSON only, no-store, never as a prop, flash or session value
// (SEC-P1-36, SEC-P1-39) and also need a recent password (ADR-215). Cancelling a rotation and signing out other sessions only take access
// away, so they need neither (ADR-238). ADR-540: while 2FA für Admin-Konten is Optional, "2FA ausschalten" needs the recent password
// only (the FormRequest refuses it in Pflicht mode).
Route::middleware(AdminRoutes::signedIn())->prefix('account')->group(function (): void {
    Route::get('/', AccountController::class)->name('account');

    Route::middleware('throttle:20,1,admin-account-1')->name('account.')->group(function (): void {
        Route::post('two-factor/rotation', [AccountTwoFactorController::class, 'start'])->middleware('staff.recent-password')->name('rotation.start');
        Route::post('two-factor/rotation/confirm', [AccountTwoFactorController::class, 'confirm'])->middleware('staff.recent-password')->name('rotation.confirm');
        Route::delete('two-factor/rotation', [AccountTwoFactorController::class, 'cancel'])->name('rotation.cancel');
        Route::post('recovery-codes', [AccountTwoFactorController::class, 'showRecoveryCodes'])->middleware('staff.recent-password')->name('recovery-codes.show');
        Route::post('recovery-codes/regenerate', [AccountTwoFactorController::class, 'regenerateRecoveryCodes'])->middleware('staff.recent-password')->name('recovery-codes.regenerate');
        Route::delete('two-factor', AccountTwoFactorDisableController::class)->middleware('staff.recent-password')->name('two-factor.disable');
        Route::delete('sessions/{handle}', [AccountSessionsController::class, 'destroy'])->where('handle', '[A-Za-z0-9_-]{16,128}')->name('sessions.destroy');
        Route::post('sessions/others', [AccountSessionsController::class, 'others'])->name('sessions.others');
    });
});
