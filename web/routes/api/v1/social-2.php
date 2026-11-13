<?php

use App\Http\Controllers\Api\V1\Social2\BuildUpdatePostController;
use App\Http\Controllers\Api\V1\Social2\CollectionController;
use App\Http\Controllers\Api\V1\Social2\CollectionItemController;
use App\Http\Controllers\Api\V1\Social2\CommentController;
use App\Http\Controllers\Api\V1\Social2\HighlightController;
use App\Http\Controllers\Api\V1\Social2\MentionController;
use App\Http\Controllers\Api\V1\Social2\ReactionController;
use App\Http\Controllers\Api\V1\Social2\VehicleFollowController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

// M4.11 Social 2.0 (09 §8.5, §8.6, §11). Flags: build_reactions, mentions, collections, vehicle_follow (on), build_comments (off); a
// route of a flag that is off answers 404 feature_disabled, after `member` so a guest hears 401 first.

// Guests too (ADR-124), read through App\Support\Viewer.
Route::middleware('throttle:browse')->group(function (): void {
    Route::get('build-updates/{update}', [BuildUpdatePostController::class, 'show'])->middleware('etag')->name('build-updates.show');
    Route::get('vehicles/{vehicle}/highlights', [HighlightController::class, 'index'])->middleware('etag')->name('vehicles.highlights.index');
    Route::get('build-updates/{update}/comments', [CommentController::class, 'index'])
        ->middleware(EnsureFeatureEnabled::class.':build_comments')
        ->name('comments.index');
});

Route::middleware('member')->group(function (): void {
    // Build updates 2.0 (UPD-01, VEH-05). Deleting stays open under a restriction: a member can always take their own content down.
    Route::post('build-updates', [BuildUpdatePostController::class, 'store'])
        ->middleware(['not-restricted:publishing', 'throttle:build-updates', 'throttle:garage-writes', 'idempotent'])
        ->name('build-updates.store');
    Route::patch('build-updates/{update}', [BuildUpdatePostController::class, 'update'])->middleware(['not-restricted:publishing', 'throttle:garage-edits'])->name('build-updates.update');
    Route::delete('build-updates/{update}', [BuildUpdatePostController::class, 'destroy'])->middleware('throttle:garage-edits')->name('build-updates.destroy');
    Route::post('build-updates/{update}/media', [BuildUpdatePostController::class, 'storePhoto'])
        ->middleware(['not-restricted:publishing', 'throttle:uploads', 'idempotent'])
        ->name('build-updates.media.store');

    // Highlights rail (VEH-01).
    Route::put('vehicles/{vehicle}/highlights', [HighlightController::class, 'update'])->middleware(['not-restricted:publishing', 'throttle:garage-edits'])->name('vehicles.highlights.update');

    // Private reactions. Taking one back stays open under a restriction.
    Route::middleware(EnsureFeatureEnabled::class.':build_reactions')->group(function (): void {
        // One route per item type (not a {type} pattern), so a guest's request is a 401 before any lookup, like every member route.
        foreach (['vehicles', 'build-updates'] as $type) {
            Route::put("$type/{id}/reactions", [ReactionController::class, 'update'])->defaults('type', $type)
                ->middleware(['not-restricted:publishing', 'throttle:reactions'])->name("reactions.$type.update");
            Route::delete("$type/{id}/reactions", [ReactionController::class, 'destroy'])->defaults('type', $type)
                ->middleware('throttle:reactions')->name("reactions.$type.destroy");
            Route::get("$type/{id}/reactions", [ReactionController::class, 'index'])->defaults('type', $type)
                ->middleware('throttle:browse')->name("reactions.$type.index");
        }
    });

    Route::get('mentions/suggest', MentionController::class)
        ->middleware([EnsureFeatureEnabled::class.':mentions', 'throttle:mention-suggest'])
        ->name('mentions.suggest');

    // [build_comments], off by default.
    Route::middleware(EnsureFeatureEnabled::class.':build_comments')->group(function (): void {
        Route::post('build-updates/{update}/comments', [CommentController::class, 'store'])
            ->middleware(['not-restricted:publishing', 'throttle:comments', 'idempotent'])->name('comments.store');
        Route::delete('comments/{comment}', [CommentController::class, 'destroy'])->middleware('throttle:garage-edits')->name('comments.destroy');
        Route::patch('vehicles/{vehicle}/comments', [CommentController::class, 'settings'])->middleware('throttle:garage-edits')->name('vehicles.comments');
    });

    // Build follow.
    Route::middleware(EnsureFeatureEnabled::class.':vehicle_follow')->group(function (): void {
        Route::put('vehicles/{vehicle}/follow', [VehicleFollowController::class, 'update'])->middleware('throttle:follows')->name('vehicles.follow');
        Route::delete('vehicles/{vehicle}/follow', [VehicleFollowController::class, 'destroy'])->middleware('throttle:unfollows')->name('vehicles.unfollow');
    });

    // Private collections (COL-01/02).
    Route::middleware([EnsureFeatureEnabled::class.':collections', 'throttle:collections'])->prefix('me/collections')->name('me.collections.')->group(function (): void {
        Route::get('/', [CollectionController::class, 'index'])->name('index');
        Route::post('/', [CollectionController::class, 'store'])->middleware('idempotent')->name('store');
        Route::put('order', [CollectionController::class, 'reorder'])->name('order');
        Route::patch('{collection}', [CollectionController::class, 'update'])->name('update');
        Route::delete('{collection}', [CollectionController::class, 'destroy'])->name('destroy');
        Route::get('{collection}/items', [CollectionItemController::class, 'index'])->name('items.index');
        Route::post('{collection}/items', [CollectionItemController::class, 'store'])->middleware('idempotent')->name('items.store');
        Route::put('{collection}/items/order', [CollectionItemController::class, 'reorder'])->name('items.order');
        Route::delete('{collection}/items/{type}/{id}', [CollectionItemController::class, 'destroy'])->name('items.destroy');
    });
});
