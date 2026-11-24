<?php

use App\Http\Controllers\Api\V1\Gift\BadgeController;
use App\Http\Controllers\Api\V1\Gift\CarOfTheDayController;
use App\Http\Controllers\Api\V1\Gift\InviteController;
use App\Http\Controllers\Api\V1\Gift\LevelController;
use Illuminate\Support\Facades\Route;

// M5.9d supporting system (m5.9d contract §1–§5, §10): level, badges, invites, the Car of the Day story line.
Route::middleware('member')->group(function (): void {
    Route::get('me/level', [LevelController::class, 'show'])->middleware('etag')->name('me.level');
    Route::get('me/badges', [BadgeController::class, 'mine'])->middleware('etag')->name('me.badges.index');
    // A read mark, under the limiter of notification read marks.
    Route::post('me/badges/seen', [BadgeController::class, 'seen'])->middleware(['throttle:notification-reads', 'idempotent'])->name('me.badges.seen');
    Route::get('me/invites', [InviteController::class, 'index'])->middleware('verified-member')->name('me.invites.index');
    Route::patch('vehicles/{vehicle}/car-of-the-day', [CarOfTheDayController::class, 'update'])
        ->middleware(['verified-member', 'not-restricted:publishing', 'throttle:garage-edits'])
        ->name('vehicles.car-of-the-day');
});

// Guests too (App\Support\Viewer reads a token if there is one).
Route::get('users/{username}/badges', [BadgeController::class, 'member'])->middleware(['throttle:public-read', 'etag'])->name('users.badges');
Route::get('invites/{code}', [InviteController::class, 'show'])->middleware('throttle:invite-lookup')->name('invites.show');
