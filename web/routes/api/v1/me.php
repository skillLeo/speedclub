<?php

use App\Http\Controllers\Api\V1\Me\AccountDeletionController;
use App\Http\Controllers\Api\V1\Me\AccountSecurityController;
use App\Http\Controllers\Api\V1\Me\DataExportController;
use App\Http\Controllers\Api\V1\Me\DeviceSessionController;
use App\Http\Controllers\Api\V1\Me\ProfileController;
use App\Http\Controllers\Api\V1\Me\ProfileImageController;
use App\Http\Controllers\Api\V1\Me\PushTokenController;
use App\Http\Controllers\Api\V1\Me\SettingsController;
use App\Http\Controllers\Api\V1\Me\TwoFactorController;
use App\Http\Controllers\Api\V1\Social\BlockController;
use App\Http\Controllers\Api\V1\Social\FollowerController;
use App\Http\Controllers\Api\V1\Social\SaveController;
use App\Http\Middleware\EnsureFeatureEnabled;
use App\Support\Auth\DeviceInfo;
use Illuminate\Support\Facades\Route;

Route::prefix('me')->name('me.')->middleware('member')->group(function (): void {
    Route::get('profile', [ProfileController::class, 'show'])->name('profile.show');
    // throttle:account-edits (SEC-P1-04) is shared with PATCH settings.
    Route::patch('profile', [ProfileController::class, 'update'])->middleware(['not-restricted:publishing', 'throttle:account-edits'])->name('profile.update');
    Route::put('username', [ProfileController::class, 'username'])->middleware(['not-restricted:publishing', 'throttle:username-check'])->name('username');

    Route::post('avatar', [ProfileImageController::class, 'avatar'])->middleware(['not-restricted:publishing', 'throttle:uploads', 'idempotent'])->name('avatar');
    Route::post('cover', [ProfileImageController::class, 'cover'])->middleware(['not-restricted:publishing', 'throttle:uploads', 'idempotent'])->name('cover');

    // Stay open under a restriction: they are not public content (UserPolicy).
    Route::get('settings', [SettingsController::class, 'show'])->name('settings.show');
    Route::patch('settings', [SettingsController::class, 'update'])->middleware('throttle:account-edits')->name('settings.update');

    // AUTH-10 (M2.2): this install's Expo push token. Sign-out removes it too (LogoutMember).
    Route::post('push-tokens', [PushTokenController::class, 'store'])->middleware(['throttle:push-tokens', 'idempotent'])->name('push-tokens.store');
    Route::delete('push-tokens/{deviceId}', [PushTokenController::class, 'destroy'])->where('deviceId', DeviceInfo::ROUTE_PATTERN)->middleware('throttle:push-tokens')->name('push-tokens.destroy');

    // PROF-04 "Entfernen". Open under a restriction and before verification, like unfollowing would be for the follower.
    Route::delete('followers/{username}', [FollowerController::class, 'destroy'])->middleware('throttle:unfollows')->name('followers.destroy');
    // SET-08. Open to unverified and restricted members, as blocking is.
    Route::get('blocks', [BlockController::class, 'index'])->name('blocks.index');

    // M2.5 account and security (SET-03 to SET-06). Each write re-checks the password; throttle:account-security bounds the guesses.
    Route::middleware('throttle:account-security')->group(function (): void {
        Route::post('email', [AccountSecurityController::class, 'requestEmail'])->name('email.request');
        Route::post('email/confirm', [AccountSecurityController::class, 'confirmEmail'])->name('email.confirm');
        Route::post('password', [AccountSecurityController::class, 'password'])->name('password');

        Route::post('two-factor', [TwoFactorController::class, 'store'])->name('two-factor.store');
        Route::post('two-factor/confirm', [TwoFactorController::class, 'confirm'])->name('two-factor.confirm');
        Route::delete('two-factor', [TwoFactorController::class, 'destroy'])->name('two-factor.destroy');
        Route::post('two-factor/recovery-codes', [TwoFactorController::class, 'recoveryCodes'])->name('two-factor.recovery-codes');

        Route::delete('sessions', [DeviceSessionController::class, 'destroyOthers'])->name('sessions.destroy-others');
        Route::delete('sessions/{session}', [DeviceSessionController::class, 'destroy'])->where('session', '[A-Za-z0-9]{1,65}')->name('sessions.destroy');

        // M2.5 data rights (SET-12, SET-13), open under every restriction (GDPR).
        Route::post('export', [DataExportController::class, 'store'])->middleware('idempotent')->name('exports.store');
        Route::post('delete', [AccountDeletionController::class, 'store'])->name('delete');
    });

    Route::get('sessions', [DeviceSessionController::class, 'index'])->name('sessions.index');
    Route::get('exports', [DataExportController::class, 'index'])->name('exports.index');
});

// SET-12: the link of the export mail. The signature is the credential (7 days, bound to the export), so it opens in any browser.
Route::get('me/exports/{export}/download', [DataExportController::class, 'download'])
    ->middleware(['signed', 'throttle:public-read'])
    ->where('export', '[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}')
    ->name('me.exports.download');

// PROF-05 [SIG sig.saved_builds]: 404 feature_disabled while the flag is off; a guest hears 401 first.
Route::get('me/saved', [SaveController::class, 'index'])
    ->middleware(['member', EnsureFeatureEnabled::class.':sig.saved_builds'])
    ->name('me.saved.index');
