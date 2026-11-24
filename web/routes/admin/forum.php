<?php

use App\Http\Controllers\Admin\Forum\ForumBanController;
use App\Http\Controllers\Admin\Forum\ForumCategoriesController;
use App\Http\Controllers\Admin\Forum\ForumPostActionsController;
use App\Http\Controllers\Admin\Forum\ForumQueueController;
use App\Http\Controllers\Admin\Forum\ForumThreadActionsController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// M5.8 ADM Forum-Moderation (+ Kategorien), m5.8-contract §6. The SplitQueue is moderation's, so are the atoms: every route needs
// moderation.view; decisions and staff tools add moderation.decide, the forum ban members.restrict, the categories moderation.rules, each
// on the route (ahead of the password check, so a role without it hears 403) and in its FormRequest. ⚿ = staff.recent-password (ADR-215).
$ulid = '[0-9A-Za-z]{26}';

Route::middleware([...AdminRoutes::signedIn(), 'can:moderation.view'])->prefix('forum')->name('forum.')->group(function () use ($ulid): void {
    Route::get('/', ForumQueueController::class)->name('queue');

    Route::middleware(['can:moderation.decide', 'staff.recent-password', 'throttle:60,1,admin-forum-1'])->group(function () use ($ulid): void {
        Route::post('posts/{post}/approve', [ForumPostActionsController::class, 'approve'])->where('post', $ulid)->name('posts.approve');
        Route::post('posts/{post}/reject', [ForumPostActionsController::class, 'reject'])->where('post', $ulid)->name('posts.reject');
        Route::post('posts/{post}/hide', [ForumPostActionsController::class, 'hide'])->where('post', $ulid)->name('posts.hide');

        foreach (['pin', 'unpin', 'lock', 'unlock', 'move', 'merge', 'solution'] as $tool) {
            Route::post("threads/{thread}/$tool", [ForumThreadActionsController::class, $tool])->where('thread', $ulid)->name("threads.$tool");
        }
    });

    Route::post('members/{member}/ban', ForumBanController::class)->where('member', $ulid)
        ->middleware(['can:members.restrict', 'staff.recent-password', 'throttle:30,1,admin-forum-2'])->name('members.ban');

    Route::middleware('can:moderation.rules')->group(function (): void {
        Route::get('categories', [ForumCategoriesController::class, 'index'])->name('categories.index');
        Route::middleware(['staff.recent-password', 'throttle:60,1,admin-forum-3'])->group(function (): void {
            Route::post('categories', [ForumCategoriesController::class, 'store'])->name('categories.store');
            Route::post('categories/order', [ForumCategoriesController::class, 'order'])->name('categories.order');
            Route::post('categories/sync', [ForumCategoriesController::class, 'sync'])->name('categories.sync');
            Route::patch('categories/{category}', [ForumCategoriesController::class, 'update'])->whereNumber('category')->name('categories.update');
            Route::delete('categories/{category}', [ForumCategoriesController::class, 'destroy'])->whereNumber('category')->name('categories.destroy');
        });
    });
});
