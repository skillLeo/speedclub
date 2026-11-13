<?php

use App\Http\Controllers\Api\V1\Businesses\BusinessController;
use App\Http\Controllers\Api\V1\Businesses\BusinessTagController;
use App\Http\Controllers\Api\V1\Businesses\ModBusinessTagController;
use App\Http\Controllers\Api\V1\Businesses\MyBusinessController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

// M4.14 business profiles (09 §8.10, §11 "businesses"; ADR-414). Flag `businesses` on every route (404 feature_disabled while off),
// after `member` on member routes so a guest hears 401 first. Businesses are found by slug, tags by ULID, team members by username.
$slug = '[a-z0-9-]{2,140}';
$ulid = '[0-9A-Za-z]{26}';
$businesses = EnsureFeatureEnabled::class.':businesses';

// Guests too (ADR-124), read through App\Support\Viewer.
Route::middleware([$businesses, 'throttle:browse'])->group(function () use ($slug): void {
    Route::get('businesses', [BusinessController::class, 'index'])->middleware('etag')->name('businesses.index');
    Route::get('businesses/{slug}', [BusinessController::class, 'show'])->where('slug', $slug)->middleware('etag')->name('businesses.show');
    Route::get('businesses/{slug}/portfolio', [BusinessController::class, 'portfolio'])->where('slug', $slug)->middleware('etag')->name('businesses.portfolio');
});

Route::middleware('member')->group(function () use ($ulid, $businesses): void {
    Route::middleware($businesses)->group(function () use ($ulid): void {
        // BIZ-02/03: the member's own business.
        Route::get('me/business', [MyBusinessController::class, 'show'])->middleware('throttle:browse')->name('me.business.show');
        Route::post('me/business', [MyBusinessController::class, 'store'])
            ->middleware(['not-restricted:publishing', 'throttle:businesses', 'idempotent'])->name('me.business.store');
        Route::patch('me/business', [MyBusinessController::class, 'update'])
            ->middleware(['not-restricted:publishing', 'throttle:businesses'])->name('me.business.update');
        Route::post('me/business/submit', [MyBusinessController::class, 'submit'])
            ->middleware(['not-restricted:publishing', 'throttle:businesses'])->name('me.business.submit');
        // Withdrawing stays open under a restriction: taking one's own content down always works.
        Route::delete('me/business', [MyBusinessController::class, 'destroy'])->middleware('throttle:businesses')->name('me.business.destroy');
        Route::post('me/business/logo', [MyBusinessController::class, 'logo'])
            ->middleware(['not-restricted:publishing', 'throttle:uploads', 'idempotent'])->name('me.business.logo');
        Route::post('me/business/cover', [MyBusinessController::class, 'cover'])
            ->middleware(['not-restricted:publishing', 'throttle:uploads', 'idempotent'])->name('me.business.cover');
        Route::post('me/business/members', [MyBusinessController::class, 'addMember'])
            ->middleware(['throttle:businesses', 'idempotent'])->name('me.business.members.store');
        Route::delete('me/business/members/{username}', [MyBusinessController::class, 'removeMember'])
            ->where('username', '[A-Za-z0-9._]{1,40}')->middleware('throttle:businesses')->name('me.business.members.destroy');

        // BIZ-03 portfolio, BIZ-04 Anfragen.
        Route::get('me/business/tag-requests', [BusinessTagController::class, 'index'])->middleware('throttle:browse')->name('me.business.tags.index');
        Route::post('me/business/tag-requests', [BusinessTagController::class, 'store'])
            ->middleware(['not-restricted:publishing', 'throttle:business-tags', 'idempotent'])->name('me.business.tags.store');
        Route::patch('me/business/tag-requests/{tag}', [BusinessTagController::class, 'update'])->where('tag', $ulid)
            ->middleware('throttle:business-tags')->name('me.business.tags.update');
        Route::delete('me/business/tag-requests/{tag}', [BusinessTagController::class, 'destroy'])->where('tag', $ulid)
            ->middleware('throttle:business-tags')->name('me.business.tags.destroy');

        // The build owner's side of "Eingebaut von".
        Route::put('mods/{modification}/business-tag', [ModBusinessTagController::class, 'update'])->where('modification', $ulid)
            ->middleware(['not-restricted:publishing', 'throttle:business-tags'])->name('mods.business-tag.update');
        Route::delete('mods/{modification}/business-tag', [ModBusinessTagController::class, 'destroy'])->where('modification', $ulid)
            ->middleware('throttle:business-tags')->name('mods.business-tag.destroy');
        Route::get('me/mod-tags', [ModBusinessTagController::class, 'index'])->middleware('throttle:browse')->name('me.mod-tags.index');
        Route::patch('me/mod-tags/{tag}', [ModBusinessTagController::class, 'decide'])->where('tag', $ulid)
            ->middleware('throttle:business-tags')->name('me.mod-tags.update');
    });
});
