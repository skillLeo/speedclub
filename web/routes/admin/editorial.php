<?php

use App\Http\Controllers\Admin\Editorial\EditorialActionsController;
use App\Http\Controllers\Admin\Editorial\EditorialController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-58 Editorial & Beispiele (09 §8.19, §10.3; M4.17). content.view reads; each write names its atom on the route ahead of the
// password check (a role without it hears 403, not a password prompt) and in its FormRequest. ⚿ = staff.recent-password (ADR-215).
// The flag write goes through UpdateFeatureFlag (a critical flag in production is four-eyes there).
$ulid = '[0-9A-Za-z]{26}';

Route::middleware([...AdminRoutes::signedIn(), 'can:content.view'])->prefix('editorial')->name('editorial.')->group(function () use ($ulid): void {
    Route::get('/', EditorialController::class)->name('index');

    Route::middleware(['can:content.edit', 'staff.recent-password', 'throttle:30,1,admin-editorial-1'])->group(function () use ($ulid): void {
        Route::post('items/{item}/hide', [EditorialActionsController::class, 'hide'])->where('item', $ulid)->name('items.hide');
        Route::post('items/{item}/show', [EditorialActionsController::class, 'show'])->where('item', $ulid)->name('items.show');
    });

    Route::post('flag', [EditorialActionsController::class, 'flag'])->middleware(['can:flags.manage', 'staff.recent-password', 'throttle:30,1,admin-editorial-2'])->name('flag');
});
