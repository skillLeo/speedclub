<?php

use App\Http\Controllers\Api\V1\Forum\ForumCategoryController;
use App\Http\Controllers\Api\V1\Forum\ForumInteractionController;
use App\Http\Controllers\Api\V1\Forum\ForumLinkedThreadsController;
use App\Http\Controllers\Api\V1\Forum\ForumPhotoController;
use App\Http\Controllers\Api\V1\Forum\ForumPostController;
use App\Http\Controllers\Api\V1\Forum\ForumThreadController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

// M5.8 Forum (10 §7, ADR-506, m5.8-contract §4). Flag `forum` on every route: off answers 404 feature_disabled, after `member` on member
// routes so a guest hears 401 first. Threads and posts are found by ULID; categories by slug. Writing needs neither a publishing nor a
// forum restriction in force (403 account_restricted); deleting one's own content stays open under a restriction.
$forum = EnsureFeatureEnabled::class.':forum';
$ulid = '[0-9A-Za-z]{26}';
$slug = '[a-z0-9-]{1,80}';
$writable = ['not-restricted:publishing', 'not-restricted:forum'];

// Guests too (ADR-124), read through App\Support\Viewer.
Route::middleware([$forum, 'throttle:browse'])->group(function () use ($ulid, $slug): void {
    Route::middleware('etag')->group(function () use ($ulid, $slug): void {
        Route::get('forum/categories', [ForumCategoryController::class, 'index'])->name('forum.categories.index');
        Route::get('forum/categories/{slug}', [ForumCategoryController::class, 'show'])->where('slug', $slug)->name('forum.categories.show');
        Route::get('forum/threads', [ForumThreadController::class, 'index'])->name('forum.threads.index');
        Route::get('forum/active', [ForumThreadController::class, 'active'])->name('forum.active');
        Route::get('forum/threads/{thread}', [ForumThreadController::class, 'show'])->where('thread', $ulid)->name('forum.threads.show');
        Route::get('forum/threads/{thread}/posts', [ForumPostController::class, 'index'])->where('thread', $ulid)->name('forum.posts.index');
        // 10 §7.4: VEH-01 "Diskussionen zu diesem Build", mod and product pages.
        Route::get('vehicles/{vehicle}/forum-threads', [ForumLinkedThreadsController::class, 'vehicle'])->where('vehicle', $ulid)->name('vehicles.forum-threads');
        Route::get('mods/{modification}/forum-threads', [ForumLinkedThreadsController::class, 'modification'])->where('modification', $ulid)->name('mods.forum-threads');
        // A product page exists only with the parts catalogue, so its discussions answer behind that flag too (M4.14 guest-read rule).
        Route::get('products/{product}/forum-threads', [ForumLinkedThreadsController::class, 'product'])->where('product', $ulid)
            ->middleware(EnsureFeatureEnabled::class.':parts_catalogue')->name('products.forum-threads');
    });

    // 10 §7.4 "search includes threads": the forum's search, also the Forum tab of DISC-02.
    Route::get('search/threads', [ForumThreadController::class, 'search'])->middleware('throttle:search')->name('search.threads');
});

Route::middleware('member')->group(function () use ($forum, $ulid, $writable): void {
    Route::middleware($forum)->group(function () use ($ulid, $writable): void {
        // FOR-04 "Ähnliche Themen" while typing the title.
        Route::get('forum/similar', [ForumThreadController::class, 'similar'])->middleware('throttle:search')->name('forum.similar');

        // FOR-05.
        Route::get('me/forum/threads', [ForumThreadController::class, 'mine'])->middleware('throttle:browse')->name('me.forum.threads');
        Route::get('me/forum/subscriptions', [ForumThreadController::class, 'subscriptions'])->middleware('throttle:browse')->name('me.forum.subscriptions');

        // Threads.
        Route::post('forum/threads', [ForumThreadController::class, 'store'])
            ->middleware([...$writable, 'throttle:forum-threads', 'idempotent'])->name('forum.threads.store');
        Route::patch('forum/threads/{thread}', [ForumThreadController::class, 'update'])->where('thread', $ulid)
            ->middleware([...$writable, 'throttle:garage-edits'])->name('forum.threads.update');
        Route::delete('forum/threads/{thread}', [ForumThreadController::class, 'destroy'])->where('thread', $ulid)
            ->middleware('throttle:garage-edits')->name('forum.threads.destroy');
        Route::post('forum/threads/{thread}/photos', [ForumPhotoController::class, 'store'])->where('thread', $ulid)
            ->middleware([...$writable, 'throttle:uploads', 'idempotent'])->name('forum.photos.store');
        Route::delete('forum/threads/{thread}/photos/{media}', [ForumPhotoController::class, 'destroy'])->where(['thread' => $ulid, 'media' => $ulid])
            ->middleware('throttle:garage-edits')->name('forum.photos.destroy');

        // Replies.
        Route::post('forum/threads/{thread}/posts', [ForumPostController::class, 'store'])->where('thread', $ulid)
            ->middleware([...$writable, 'throttle:forum-replies', 'idempotent'])->name('forum.posts.store');
        Route::patch('forum/posts/{post}', [ForumPostController::class, 'update'])->where('post', $ulid)
            ->middleware([...$writable, 'throttle:garage-edits'])->name('forum.posts.update');
        Route::delete('forum/posts/{post}', [ForumPostController::class, 'destroy'])->where('post', $ulid)
            ->middleware('throttle:garage-edits')->name('forum.posts.destroy');

        // "Hilfreich" (count shown in the forum only, ADR-506). Taking one back stays open under a restriction.
        Route::put('forum/posts/{post}/vote', [ForumInteractionController::class, 'vote'])->where('post', $ulid)
            ->middleware([...$writable, 'throttle:forum-votes'])->name('forum.votes.update');
        Route::delete('forum/posts/{post}/vote', [ForumInteractionController::class, 'unvote'])->where('post', $ulid)
            ->middleware('throttle:forum-votes')->name('forum.votes.destroy');

        // "Gelöst" by the thread's author; subscriptions.
        Route::put('forum/threads/{thread}/solution', [ForumInteractionController::class, 'solve'])->where('thread', $ulid)
            ->middleware('throttle:garage-edits')->name('forum.solution.update');
        Route::delete('forum/threads/{thread}/solution', [ForumInteractionController::class, 'unsolve'])->where('thread', $ulid)
            ->middleware('throttle:garage-edits')->name('forum.solution.destroy');
        Route::put('forum/threads/{thread}/subscription', [ForumInteractionController::class, 'subscribe'])->where('thread', $ulid)
            ->middleware('throttle:garage-edits')->name('forum.subscription.update');
        Route::delete('forum/threads/{thread}/subscription', [ForumInteractionController::class, 'unsubscribe'])->where('thread', $ulid)
            ->middleware('throttle:garage-edits')->name('forum.subscription.destroy');
    });
});
