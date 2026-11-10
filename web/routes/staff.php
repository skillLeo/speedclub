<?php

use App\Http\Controllers\Staff\ApprovalDownloadController;
use App\Http\Controllers\Staff\SessionKeepAliveController;
use App\Http\Middleware\EnsureStaffTwoFactor;
use Illuminate\Support\Facades\Route;

// Staff session and four-eyes routes of the server lane (M3.1 contract §1), loaded by AdminServiceProvider with prefix "admin",
// name "admin." and the groups ['web', 'staff'], like routes/admin.php. staff.active and the access fence come with the group.

Route::middleware(['auth:staff', EnsureStaffTwoFactor::class])->group(function (): void {
    // ADR-217: "Sitzung verlängern".
    Route::post('session/keep-alive', SessionKeepAliveController::class)->middleware('throttle:30,1')->name('session.keep-alive');

    // ADR-214: the file an approved audit export wrote, for its requester, 24 hours. The id goes in the query, which RefuseLongQuery
    // bounds, not in the path: a GET with a session and a path parameter would store any length of path (SEC-P1-47).
    Route::get('approvals/download', ApprovalDownloadController::class)->middleware('signed')->name('approvals.download');
});
