<?php

use App\Http\Controllers\Admin\Support\AdminRoutes;
use App\Http\Controllers\Admin\Team\InviteAcceptController;
use App\Http\Controllers\Admin\Team\PermissionsController;
use App\Http\Controllers\Admin\Team\RolesController;
use App\Http\Controllers\Admin\Team\StaffActionsController;
use App\Http\Controllers\Admin\Team\StaffShowController;
use App\Http\Controllers\Admin\Team\TeamIndexController;
use Illuminate\Support\Facades\Route;

// ADM-39…42 (m3.6-contract §2). Every page needs staff.view; inviting staff.invite, every other step on a staff member staff.manage, roles
// and the matrix roles.manage. Every write asks for a password confirmed within 5 minutes (ADR-215); the atom also sits on the route, ahead of
// the password check, so a role without it hears 403 rather than a password prompt. Four-eyes steps only create approval requests
// (ADR-214/237). {staff} is the numeric staff id, so team/roles, team/permissions and team/approvals (approvals.php) never match it.
Route::middleware([...AdminRoutes::signedIn(), 'can:staff.view'])->prefix('team')->name('team.')->where(['staff' => '[0-9]+', 'role' => '[0-9]+'])->group(function (): void {
    Route::get('/', TeamIndexController::class)->name('staff');
    Route::get('roles', [RolesController::class, 'index'])->name('roles');
    Route::get('permissions', [PermissionsController::class, 'index'])->name('permissions');
    Route::get('{staff}', StaffShowController::class)->name('staff.show');

    Route::middleware('throttle:30,1')->group(function (): void {
        Route::post('invite', [StaffActionsController::class, 'invite'])->middleware(['can:staff.invite', 'staff.recent-password'])->name('invite');
        Route::post('{staff}/resend-invite', [StaffActionsController::class, 'resendInvite'])->middleware(['can:staff.invite', 'staff.recent-password'])->name('resend-invite');

        Route::middleware(['can:staff.manage', 'staff.recent-password'])->group(function (): void {
            Route::patch('{staff}/roles', [StaffActionsController::class, 'roles'])->name('roles.update');
            Route::post('{staff}/deactivate', [StaffActionsController::class, 'deactivate'])->name('deactivate');
            Route::post('{staff}/reactivate', [StaffActionsController::class, 'reactivate'])->name('reactivate');
            Route::post('{staff}/delete', [StaffActionsController::class, 'destroy'])->name('delete');
            Route::post('{staff}/revoke-sessions', [StaffActionsController::class, 'revokeSessions'])->name('revoke-sessions');
            Route::post('{staff}/reset-two-factor', [StaffActionsController::class, 'resetTwoFactor'])->name('reset-two-factor');
        });

        Route::middleware(['can:roles.manage', 'staff.recent-password'])->group(function (): void {
            Route::post('roles', [RolesController::class, 'store'])->name('roles.store');
            Route::patch('roles/{role}', [RolesController::class, 'update'])->name('roles.update-role');
            Route::delete('roles/{role}', [RolesController::class, 'destroy'])->name('roles.destroy');
            Route::patch('permissions', [PermissionsController::class, 'update'])->name('permissions.update');
        });
        // The diff the page shows before saving (JSON, changes nothing).
        Route::post('permissions/diff', [PermissionsController::class, 'diff'])->middleware('can:roles.manage')->name('permissions.diff');
    });
});

// The invite link (m3.6 §1, ADR-218/237): a guest page; the token stays in the fragment and the page posts it. Rate-limited per address.
Route::get('invite', [InviteAcceptController::class, 'show'])->name('invite');
Route::post('invite', [InviteAcceptController::class, 'store'])->middleware('throttle:10,1')->name('invite.store');
