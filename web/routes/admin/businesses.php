<?php

use App\Http\Controllers\Admin\Businesses\BusinessActionsController;
use App\Http\Controllers\Admin\Businesses\BusinessQueueController;
use App\Http\Controllers\Admin\Businesses\BusinessShowController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-55/56 Betriebe (09 §10.3, M4.14 backend; pages for the admin-builder round). The SplitQueue is shared with reports and events
// (09 §10.2), so the atoms are moderation's, as for events (ADR-437 a): every route needs moderation.view; decisions add
// moderation.decide on the route (ahead of the password check, so a role without it hears 403) and in their FormRequest.
// ⚿ = staff.recent-password (ADR-215). Suspending is four-eyes (business.suspend): the route only asks for the approval.
$ulid = '[0-9A-Za-z]{26}';

Route::middleware([...AdminRoutes::signedIn(), 'can:moderation.view'])->prefix('businesses')->name('businesses.')->group(function () use ($ulid): void {
    Route::get('/', BusinessQueueController::class)->name('queue');
    Route::get('{business}', [BusinessShowController::class, 'show'])->where('business', $ulid)->name('show');
    Route::get('{business}/preview', [BusinessShowController::class, 'preview'])->where('business', $ulid)->middleware('throttle:120,1')->name('preview');

    Route::middleware(['can:moderation.decide', 'staff.recent-password', 'throttle:60,1'])->group(function () use ($ulid): void {
        Route::post('{business}/verify', [BusinessActionsController::class, 'verify'])->where('business', $ulid)->name('verify');
        Route::post('{business}/reject', [BusinessActionsController::class, 'reject'])->where('business', $ulid)->name('reject');
        Route::post('{business}/suspend', [BusinessActionsController::class, 'suspend'])->where('business', $ulid)->name('suspend');
        Route::post('{business}/reinstate', [BusinessActionsController::class, 'reinstate'])->where('business', $ulid)->name('reinstate');
        Route::post('{business}/reopen', [BusinessActionsController::class, 'reopen'])->where('business', $ulid)->name('reopen');
    });
});
