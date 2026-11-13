<?php

use App\Http\Controllers\Api\V1\Security\OnboardingController;
use App\Http\Controllers\Api\V1\Security\PasskeyController;
use App\Http\Controllers\Api\V1\Security\ProviderController;
use App\Http\Controllers\Api\V1\Security\ReauthController;
use App\Http\Controllers\Api\V1\Security\SecurityActivityController;
use App\Http\Middleware\EnsureFeatureEnabled;
use App\Http\Middleware\RequireRecentAuthentication;
use Illuminate\Support\Facades\Route;

// M4.6 Auth 2.0 (09 §8.1, §8.2): AUTH-09b, sudo mode, passkeys and linked providers. Open under restrictions (account security), before
// AUTH-09b too (EnsureCurrentConsent::PENDING_TERMS_EXEMPT). RequireRecentAuthentication is the `recent.auth:10` of the spec; the lead
// registers that alias in bootstrap/app.php. The parameter is {memberPasskey}: laravel/passkeys binds {passkey} to its own model.
$recent = RequireRecentAuthentication::class.':10';

Route::prefix('me')->name('me.')->middleware('member')->group(function () use ($recent): void {
    Route::post('onboarding/accept', [OnboardingController::class, 'accept'])->middleware('throttle:account-edits')->name('onboarding.accept');

    Route::middleware('throttle:reauth')->group(function (): void {
        Route::post('reauth', [ReauthController::class, 'store'])->name('reauth');
        Route::post('reauth/email', [ReauthController::class, 'email'])->name('reauth.email');
        Route::post('reauth/passkey-options', [ReauthController::class, 'passkeyOptions'])->name('reauth.passkey-options');
    });

    // M4.7 account security (09 §7.9, §8.4): SET-19 summary, SET-21 activity and "Das war ich nicht". Sessions (SET-06) live in me.php.
    Route::get('sign-in-methods', [SecurityActivityController::class, 'methods'])->name('sign-in-methods');
    Route::get('security-events', [SecurityActivityController::class, 'index'])->name('security-events.index');
    Route::post('security/secure', [SecurityActivityController::class, 'secure'])->middleware(['throttle:account-security', 'idempotent'])->name('security.secure');

    Route::get('passkeys', [PasskeyController::class, 'index'])->name('passkeys.index');
    Route::get('providers', [ProviderController::class, 'index'])->name('providers.index');

    Route::middleware(['throttle:auth-methods', $recent])->group(function (): void {
        // SEC-M46-01: a new way in needs a proved address, as two-factor setup does. Before that the account may be a stranger's
        // pre-registration of the address (ADR-133), and the owner's later proof must not find the stranger's passkey or provider in place.
        Route::post('passkeys/options', [PasskeyController::class, 'options'])->middleware([EnsureFeatureEnabled::class.':auth.passkeys', 'verified-member'])->name('passkeys.options');
        Route::post('passkeys', [PasskeyController::class, 'store'])->middleware([EnsureFeatureEnabled::class.':auth.passkeys', 'verified-member', 'idempotent'])->name('passkeys.store');
        Route::patch('passkeys/{memberPasskey}', [PasskeyController::class, 'update'])->whereUlid('memberPasskey')->name('passkeys.update');
        Route::delete('passkeys/{memberPasskey}', [PasskeyController::class, 'destroy'])->whereUlid('memberPasskey')->name('passkeys.destroy');

        Route::post('providers', [ProviderController::class, 'store'])->middleware(['verified-member', 'idempotent'])->name('providers.store');
        Route::delete('providers/{provider}', [ProviderController::class, 'destroy'])->where('provider', '[A-Za-z0-9]{1,26}')->name('providers.destroy');
    });
});
