<?php

use App\Http\Controllers\Api\V1\Auth\EmailVerificationController;
use App\Http\Controllers\Api\V1\Auth\PasskeySignInController;
use App\Http\Controllers\Api\V1\Auth\PasswordResetController;
use App\Http\Controllers\Api\V1\Auth\RegistrationController;
use App\Http\Controllers\Api\V1\Auth\SecureAccountLinkController;
use App\Http\Controllers\Api\V1\Auth\SessionController;
use App\Http\Controllers\Api\V1\Auth\SocialSignInController;
use App\Http\Controllers\Api\V1\Auth\TwoFactorChallengeController;
use App\Http\Controllers\Api\V1\Auth\UsernameCheckController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->name('auth.')->group(function (): void {
    Route::post('register', [RegistrationController::class, 'store'])->middleware('throttle:member-register')->name('register');
    Route::post('login', [SessionController::class, 'login'])->middleware('throttle:member-login')->name('login');
    // AUTH-11 (M2.5): per IP here, plus 5 wrong codes a minute per challenge and account in the action.
    Route::post('two-factor/challenge', [TwoFactorChallengeController::class, 'store'])->middleware('throttle:two-factor-challenge')->name('two-factor.challenge');

    // M4.6 Auth 2.0 (09 §8.1): the passwordless e-mail code. email/verify takes it too, with attempt_id.
    Route::post('email/start', [EmailVerificationController::class, 'start'])->middleware('throttle:auth-email-start')->name('email.start');
    Route::post('email/verify', [EmailVerificationController::class, 'verify'])->middleware('throttle:member-verify')->name('email.verify');
    Route::post('email/resend', [EmailVerificationController::class, 'resend'])->middleware('throttle:member-email')->name('email.resend');

    Route::post('password/forgot', [PasswordResetController::class, 'forgot'])->middleware('throttle:member-email')->name('password.forgot');
    Route::post('password/reset', [PasswordResetController::class, 'reset'])->middleware('throttle:member-verify')->name('password.reset');

    // M4.6: Apple and Google ID tokens (flags off until the owner supplies client IDs, OA-15/OA-26), AUTH-16 link, passkeys (09 §8.2).
    // M4.7 (09 §8.4): "Das war ich nicht" from a login alert; the token in the body is the credential.
    Route::post('secure-account', [SecureAccountLinkController::class, 'store'])->middleware('throttle:auth-secure-account')->name('secure-account');
    // SEC-M46-05: server-issued nonces for both providers.
    Route::post('nonce', [SocialSignInController::class, 'nonce'])->middleware('throttle:auth-social')->name('nonce');
    Route::post('apple', [SocialSignInController::class, 'apple'])->middleware(['throttle:auth-social', EnsureFeatureEnabled::class.':auth.apple'])->name('apple');
    Route::post('google', [SocialSignInController::class, 'google'])->middleware(['throttle:auth-social', EnsureFeatureEnabled::class.':auth.google'])->name('google');
    Route::post('link/confirm', [SocialSignInController::class, 'confirmLink'])->middleware('throttle:auth-email-verify')->name('link.confirm');
    Route::post('passkeys/options', [PasskeySignInController::class, 'options'])->middleware(['throttle:auth-passkeys', EnsureFeatureEnabled::class.':auth.passkeys'])->name('passkeys.options');
    Route::post('passkeys/verify', [PasskeySignInController::class, 'verify'])->middleware(['throttle:auth-passkeys', EnsureFeatureEnabled::class.':auth.passkeys'])->name('passkeys.verify');

    // The one authenticated route open to a member who must change the password (ADR-137). Anything new uses `member`.
    Route::post('logout', [SessionController::class, 'logout'])->middleware('auth:sanctum')->name('logout');

    Route::middleware('member')->group(function (): void {
        Route::post('token/rotate', [SessionController::class, 'rotate'])->middleware('throttle:token-rotate')->name('token.rotate');
        Route::get('me', [SessionController::class, 'me'])->name('me');
    });
});

Route::get('usernames/check', UsernameCheckController::class)->middleware('throttle:username-check')->name('usernames.check');
