<?php

use App\Http\Controllers\Api\V1\Public\ConnectionController;
use App\Http\Controllers\Api\V1\Public\PublicMemberController;
use App\Http\Controllers\Api\V1\Public\PublicVehicleController;
use Illuminate\Support\Facades\Route;

// Guests included, so no `member` here: App\Support\Viewer reads a token if there is one (05_ARCHITECTURE §7, ADR-124).
Route::prefix('public')->name('public.')->middleware(['throttle:public-read', 'etag'])->group(function (): void {
    Route::get('vehicles/{slug}', [PublicVehicleController::class, 'show'])->name('vehicles.show');
    Route::get('vehicles/{slug}/mods/{modification}', [PublicVehicleController::class, 'modification'])->name('vehicles.mods.show');
    Route::get('vehicles/{slug}/updates', [PublicVehicleController::class, 'updates'])->name('vehicles.updates.index');
    Route::get('vehicles/{slug}/updates/{update}', [PublicVehicleController::class, 'update'])->name('vehicles.updates.show');

    Route::get('users/{username}', [PublicMemberController::class, 'show'])->name('users.show');
    Route::get('users/{username}/vehicles', [PublicMemberController::class, 'vehicles'])->name('users.vehicles');
    Route::get('users/{username}/updates', [PublicMemberController::class, 'updates'])->name('users.updates');
    // PROF-04. Under public/ like the profile, as guests may read them (02_PRODUCT_SPEC §3.1).
    Route::get('users/{username}/followers', [ConnectionController::class, 'followers'])->name('users.followers');
    Route::get('users/{username}/following', [ConnectionController::class, 'following'])->name('users.following');
});
