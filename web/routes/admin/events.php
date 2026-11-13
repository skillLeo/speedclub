<?php

use App\Http\Controllers\Admin\Events\EventActionsController;
use App\Http\Controllers\Admin\Events\EventQueueController;
use App\Http\Controllers\Admin\Events\EventShowController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-53/54 Treffen (09 §10.3, M4.12 backend; pages in M4.17). The SplitQueue is shared with reports (09 §10.2), so the atoms are
// moderation's: every route needs moderation.view; decisions add moderation.decide on the route
// (ahead of the password check, so a role without it hears 403) and in their FormRequest. ⚿ = staff.recent-password (ADR-215).
$ulid = '[0-9A-Za-z]{26}';

Route::middleware([...AdminRoutes::signedIn(), 'can:moderation.view'])->prefix('events')->name('events.')->group(function () use ($ulid): void {
    Route::get('/', EventQueueController::class)->name('queue');
    Route::get('{event}', [EventShowController::class, 'show'])->where('event', $ulid)->name('show');
    Route::get('{event}/preview', [EventShowController::class, 'preview'])->where('event', $ulid)->middleware('throttle:120,1')->name('preview');

    Route::middleware(['can:moderation.decide', 'staff.recent-password', 'throttle:60,1'])->group(function () use ($ulid): void {
        Route::post('{event}/approve', [EventActionsController::class, 'approve'])->where('event', $ulid)->name('approve');
        Route::post('{event}/reject', [EventActionsController::class, 'reject'])->where('event', $ulid)->name('reject');
        Route::post('{event}/cancel', [EventActionsController::class, 'cancel'])->where('event', $ulid)->name('cancel');
        Route::post('{event}/reopen', [EventActionsController::class, 'reopen'])->where('event', $ulid)->name('reopen');
    });
});
