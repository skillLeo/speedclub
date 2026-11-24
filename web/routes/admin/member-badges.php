<?php

use App\Http\Controllers\Admin\Members\MemberBadgesController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use App\Http\Controllers\Admin\Support\RecordLookup;
use Illuminate\Support\Facades\Route;

// ADM-10 "Abzeichen entziehen" (SEC-P5G-05): abuse handling like ADM-62's "Spot entfernen", so moderation.decide on the route ahead of
// the password check (a role without it hears 403), then ⚿ staff.recent-password (ADR-215); members.view like the whole record.
Route::middleware([...AdminRoutes::signedIn(), 'can:members.view', 'can:moderation.decide', 'staff.recent-password', 'throttle:30,1,admin-member-badges-1'])
    ->prefix('members/{member}/badges')
    ->name('members.badges.')
    ->where(['member' => RecordLookup::MEMBER, 'badge' => '[a-z0-9][a-z0-9-]{2,63}'])
    ->group(function (): void {
        Route::post('{badge}/revoke', [MemberBadgesController::class, 'revoke'])->name('revoke');
    });
