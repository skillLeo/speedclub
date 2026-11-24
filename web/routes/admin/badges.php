<?php

use App\Http\Controllers\Admin\Badges\BadgeActionsController;
use App\Http\Controllers\Admin\Badges\BadgeEditController;
use App\Http\Controllers\Admin\Badges\BadgesIndexController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-63 "Abzeichen" (M5.9d admin, m5.9d contract §2, ADR-513) under Marke & Inhalte: content.view reads (list, a badge, the preview),
// content.edit writes (on the route ahead of the password check, so a role without it hears 403, and in each FormRequest and Action).
// ⚿ = staff.recent-password (ADR-215) on every write. No four-eyes. {badge} is the badge key; "new" and "preview" are never keys.
$key = '[a-z0-9][a-z0-9-]{2,63}';

Route::middleware([...AdminRoutes::signedIn(), 'can:content.view'])->prefix('content/badges')->name('badges.')->group(function () use ($key): void {
    Route::get('/', BadgesIndexController::class)->name('index');
    Route::get('new', [BadgeEditController::class, 'create'])->middleware('can:content.edit')->name('create');
    Route::get('preview', [BadgeActionsController::class, 'preview'])->middleware('throttle:60,1,admin-badges-1')->name('preview');
    Route::get('{badge}', [BadgeEditController::class, 'show'])->where('badge', $key)->name('show');

    Route::middleware(['can:content.edit', 'staff.recent-password', 'throttle:30,1,admin-badges-2'])->group(function () use ($key): void {
        Route::post('/', [BadgeActionsController::class, 'store'])->name('store');
        Route::patch('{badge}', [BadgeActionsController::class, 'update'])->where('badge', $key)->name('update');
        Route::post('{badge}/active', [BadgeActionsController::class, 'active'])->where('badge', $key)->name('active');
        Route::post('{badge}/apply', [BadgeActionsController::class, 'apply'])->where('badge', $key)->name('apply');
    });
});
