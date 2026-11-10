<?php

use App\Http\Controllers\Api\V1\Auth\EmailVerificationController;
use App\Http\Controllers\Api\V1\Auth\PasswordResetController;
use App\Http\Controllers\Api\V1\Auth\RegistrationController;
use App\Http\Controllers\Api\V1\Auth\SessionController;
use App\Http\Controllers\Api\V1\Auth\TwoFactorChallengeController;
use App\Http\Controllers\Api\V1\Auth\UsernameCheckController;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->name('auth.')->group(function (): void {
    Route::post('register', [RegistrationController::class, 'store'])->middleware('throttle:member-register')->name('register');
    Route::post('login', [SessionController::class, 'login'])->middleware('throttle:member-login')->name('login');
    // AUTH-11 (M2.5): per IP here, plus 5 wrong codes a minute per challenge and account in the action.
    Route::post('two-factor/challenge', [TwoFactorChallengeController::class, 'store'])->middleware('throttle:two-factor-challenge')->name('two-factor.challenge');

    Route::post('email/verify', [EmailVerificationController::class, 'verify'])->middleware('throttle:member-verify')->name('email.verify');
    Route::post('email/resend', [EmailVerificationController::class, 'resend'])->middleware('throttle:member-email')->name('email.resend');

    Route::post('password/forgot', [PasswordResetController::class, 'forgot'])->middleware('throttle:member-email')->name('password.forgot');
    Route::post('password/reset', [PasswordResetController::class, 'reset'])->middleware('throttle:member-verify')->name('password.reset');

    // The one authenticated route open to a member who must change the password (ADR-137). Anything new uses `member`.
    Route::post('logout', [SessionController::class, 'logout'])->middleware('auth:sanctum')->name('logout');

    Route::middleware('member')->group(function (): void {
        Route::post('token/rotate', [SessionController::class, 'rotate'])->middleware('throttle:token-rotate')->name('token.rotate');
        Route::get('me', [SessionController::class, 'me'])->name('me');
    });
});

Route::get('usernames/check', UsernameCheckController::class)->middleware('throttle:username-check')->name('usernames.check');
