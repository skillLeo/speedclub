<?php

use App\Http\Controllers\Admin\Spots\SpotActionsController;
use App\Http\Controllers\Admin\Spots\SpotShowController;
use App\Http\Controllers\Admin\Spots\SpotsIndexController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-62 Spots (M5.9b admin, m5.9b contract §7) under Moderation: moderation.view reads, "Spot entfernen" adds moderation.decide on the
// route (ahead of the password check, so a role without it hears 403) and in its FormRequest (ADR-437 a). ⚿ = staff.recent-password
// (ADR-215). Not four-eyes (one spot; a bulk run is capped at 50 and at 100 direct removals in 24 h, RemoveSpots).
$ulid = '[0-9A-Za-z]{26}';

Route::middleware([...AdminRoutes::signedIn(), 'can:moderation.view'])->prefix('moderation/spots')->name('spots.')->group(function () use ($ulid): void {
    Route::get('/', SpotsIndexController::class)->name('index');
    Route::get('{spot}', SpotShowController::class)->where('spot', $ulid)->name('show');

    Route::middleware(['can:moderation.decide', 'staff.recent-password', 'throttle:60,1,admin-spots-1'])->group(function () use ($ulid): void {
        Route::post('bulk-remove', [SpotActionsController::class, 'bulk'])->name('bulk-remove');
        Route::post('{spot}/remove', [SpotActionsController::class, 'remove'])->where('spot', $ulid)->name('remove');
    });
});
