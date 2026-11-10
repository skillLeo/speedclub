<?php

use App\Http\Controllers\Admin\Members\MemberActionsController;
use App\Http\Controllers\Admin\Members\MemberExportDownloadController;
use App\Http\Controllers\Admin\Members\MemberJsonController;
use App\Http\Controllers\Admin\Members\MembersBulkController;
use App\Http\Controllers\Admin\Members\MembersExportController;
use App\Http\Controllers\Admin\Members\MemberShowController;
use App\Http\Controllers\Admin\Members\MembersIndexController;
use App\Http\Controllers\Admin\Members\MembersListExportRequestController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use App\Http\Controllers\Admin\Support\RecordLookup;
use Illuminate\Support\Facades\Route;

// ADM-09/10 (m3.2-contract §2). Every route needs members.view; each action adds its own atom (FormRequest) and, for ⚿ writes, a
// password confirmed within 5 minutes (ADR-215). The atom also sits on the route, ahead of the password check, so a role without it hears
// 403 rather than a password prompt. Four-eyes actions only create approval requests (ADR-214). {member} is the ULID or the
// username (RecordLookup).
Route::middleware([...AdminRoutes::signedIn(), 'can:members.view'])->prefix('members')->name('members.')->where(['member' => RecordLookup::MEMBER])->group(function (): void {
    Route::get('/', MembersIndexController::class)->name('index');
    // ADR-232: a list CSV is an export: lists.export besides members.view (the Analyst has none).
    Route::get('export.csv', MembersExportController::class)->middleware(['can:lists.export', 'throttle:10,1'])->name('export');
    Route::post('export-request', MembersListExportRequestController::class)->middleware(['can:members.export', 'can:members.view_pii', 'staff.recent-password', 'throttle:10,1'])->name('list-export');
    Route::post('bulk', MembersBulkController::class)->middleware(['staff.recent-password', 'throttle:20,1'])->name('bulk');

    Route::get('{member}', MemberShowController::class)->name('show');

    Route::middleware('throttle:60,1')->group(function (): void {
        Route::patch('{member}', [MemberActionsController::class, 'update'])->middleware(['can:members.edit', 'staff.recent-password'])->name('update');
        Route::post('{member}/restrict', [MemberActionsController::class, 'restrict'])->middleware(['can:members.restrict', 'staff.recent-password'])->name('restrict');
        Route::post('{member}/suspend', [MemberActionsController::class, 'suspend'])->middleware(['can:members.suspend', 'staff.recent-password'])->name('suspend');
        Route::post('{member}/lift', [MemberActionsController::class, 'lift'])->middleware(['can:members.restrict', 'staff.recent-password'])->name('lift');
        Route::post('{member}/reset-link', [MemberActionsController::class, 'resetLink'])->middleware('can:members.reset_password')->name('reset-link');
        Route::post('{member}/force-password-change', [MemberActionsController::class, 'forcePasswordChange'])->middleware(['can:members.reset_password', 'staff.recent-password'])->name('force-password-change');
        Route::post('{member}/revoke-sessions', [MemberActionsController::class, 'revokeSessions'])->middleware(['can:members.revoke_sessions', 'staff.recent-password'])->name('revoke-sessions');
        Route::post('{member}/reset-two-factor', [MemberActionsController::class, 'resetTwoFactor'])->middleware(['can:members.reset_2fa', 'staff.recent-password'])->name('reset-two-factor');
        Route::post('{member}/email', [MemberActionsController::class, 'changeEmail'])->middleware(['can:members.edit', 'staff.recent-password'])->name('email');
        Route::post('{member}/export', [MemberActionsController::class, 'export'])->middleware('can:members.export')->name('export-data');
        Route::post('{member}/delete', [MemberActionsController::class, 'destroy'])->middleware('can:members.delete')->name('delete');

        // JSON only (SF-8, SF-2): the view-as URL and the unmasked address never pass through a prop, flash or the session. Starting a view-as
        // and lifting a restriction need a recent password (SF-4 of the M3.2 review); a stale one answers JSON 403 password_confirmation_required.
        Route::post('{member}/view-as', [MemberJsonController::class, 'startViewAs'])->middleware(['can:members.view_as', 'staff.recent-password', 'throttle:10,1'])->name('view-as');
        Route::delete('{member}/view-as', [MemberJsonController::class, 'endViewAs'])->middleware('can:members.view_as')->name('view-as.end');
        Route::post('{member}/pii', [MemberJsonController::class, 'revealPii'])->middleware(['can:members.view_pii', 'throttle:30,1'])->name('pii');
    });

    Route::get('{member}/exports/{export}/download', MemberExportDownloadController::class)->middleware(['can:members.export', 'throttle:20,1'])->whereUlid('export')->name('exports.download');
});
