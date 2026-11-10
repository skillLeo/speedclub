<?php

use App\Http\Controllers\Admin\Approvals\ApprovalDecisionController;
use App\Http\Controllers\Admin\Approvals\ApprovalsController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-43 (ADR-214). Every staff member sees their own requests; deciding needs approvals.decide (and the action's atoms, checked by the
// engine) and a recent password; withdrawing is the requester's.
Route::middleware(AdminRoutes::signedIn())->prefix('team/approvals')->name('team.')->group(function (): void {
    Route::get('/', ApprovalsController::class)->name('approvals');

    Route::middleware('throttle:60,1')->whereUlid('approval')->group(function (): void {
        Route::post('{approval}/approve', [ApprovalDecisionController::class, 'approve'])->middleware(['can:approvals.decide', 'staff.recent-password'])->name('approvals.approve');
        Route::post('{approval}/deny', [ApprovalDecisionController::class, 'deny'])->middleware(['can:approvals.decide', 'staff.recent-password'])->name('approvals.deny');
        Route::post('{approval}/cancel', [ApprovalDecisionController::class, 'cancel'])->name('approvals.cancel');
    });
});
