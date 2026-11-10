<?php

use App\Http\Controllers\Admin\Auth\LoginController;
use App\Http\Controllers\Admin\Auth\TwoFactorSetupController;
use App\Http\Middleware\EnsureStaffTwoFactor;
use Illuminate\Support\Facades\Route;

// ADM-01. With Fortify's views on, Fortify itself serves GET /admin/login (route "login") through its view callback; a second
// route on the same URL would replace it.
if (config('fortify.views') !== true) {
    Route::get('login', LoginController::class)->middleware('guest:staff')->name('login');
}

// ADM-03: reachable before enrolment (EnsureStaffTwoFactor::ENROLMENT_ROUTES), nothing secret in its props.
Route::get('two-factor/setup', TwoFactorSetupController::class)
    ->middleware(['auth:staff', EnsureStaffTwoFactor::class])
    ->name('two-factor.setup');
