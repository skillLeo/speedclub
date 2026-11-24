<?php

use App\Http\Controllers\Admin\Crews\CrewActionsController;
use App\Http\Controllers\Admin\Crews\CrewShowController;
use App\Http\Controllers\Admin\Crews\CrewsIndexController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-80/81 Crews (R4-2.3, contract-crews.md §6/§8): the staff atom of the crew Staff actions is moderation.decide (C6), and it guards the
// whole module, reads included (lead's brief: other roles hear 403). The writes are DSA decisions or audited state changes with a reason,
// each behind ⚿ = staff.recent-password (ADR-215). No four-eyes: a staff delete only follows a hide (the founder already has the statement
// of reasons) and RestoreCrew undoes it. {crew} is a ULID; deleted crews resolve too.
Route::middleware([...AdminRoutes::signedIn(), 'can:moderation.decide'])->prefix('crews')->name('crews.')->group(function (): void {
    Route::get('/', CrewsIndexController::class)->name('index');
    Route::get('{crew}', CrewShowController::class)->whereUlid('crew')->withTrashed()->name('show');

    Route::middleware(['staff.recent-password', 'throttle:60,1,admin-crews-1'])->group(function (): void {
        foreach (['hide', 'unhide', 'remove', 'restore'] as $action) {
            Route::post("{crew}/$action", [CrewActionsController::class, $action])->whereUlid('crew')->withTrashed()->name($action);
        }
    });
});
