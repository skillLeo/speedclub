<?php

use App\Http\Controllers\Api\V1\Messaging\BroadcastAuthController;
use App\Http\Controllers\Api\V1\Messaging\ChatMediaController;
use App\Http\Controllers\Api\V1\Messaging\ConversationController;
use App\Http\Controllers\Api\V1\Messaging\MessageController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

// M2.4 messaging (m2.4-contract §2). Reads are open to every member (their own conversations only); everything that writes carries
// verified-member (ADR-139), and what reaches the other member also not-restricted:messaging. {conversation} and {message} are ULIDs; any
// conversation the member is not an active participant of is 404.
Route::middleware('member')->group(function (): void {
    // throttle:browse (300/min per member) and ETag: the inbox polls every 15 s, an open thread every 3 s; an idle poll is a 304.
    // no-store: message text must never land in a browser or NSURLCache store (review #3); the app keeps its copy in memory.
    Route::middleware(['throttle:browse', 'etag:no-store'])->group(function (): void {
        Route::get('conversations', [ConversationController::class, 'index'])->name('conversations.index');
        Route::get('conversations/{conversation}', [ConversationController::class, 'show'])->name('conversations.show');
        Route::get('conversations/{conversation}/messages', [MessageController::class, 'index'])->name('conversations.messages.index');
    });

    Route::post('broadcasting/auth', BroadcastAuthController::class)->middleware('throttle:realtime-auth')->name('broadcasting.auth');

    Route::middleware('verified-member')->group(function (): void {
        Route::middleware('not-restricted:messaging')->group(function (): void {
            Route::post('conversations', [ConversationController::class, 'store'])->middleware('throttle:conversations')->name('conversations.store');
            Route::post('conversations/{conversation}/messages', [MessageController::class, 'store'])->middleware('throttle:messages')->name('conversations.messages.store');
            Route::post('conversations/{conversation}/media', [MessageController::class, 'upload'])->middleware(['throttle:uploads', 'idempotent'])->name('conversations.media.store');
            Route::post('conversations/{conversation}/typing', [ConversationController::class, 'typing'])
                ->middleware([EnsureFeatureEnabled::class.':sig.msg_typing', 'throttle:typing'])->name('conversations.typing');
            Route::post('messages/{message}/reactions', [MessageController::class, 'react'])
                ->middleware([EnsureFeatureEnabled::class.':sig.msg_reactions', 'throttle:conversation-edits'])->name('messages.reactions.store');
        });

        // The member's own side: open under a messaging restriction (a member can always tidy up and take things down).
        Route::middleware('throttle:conversation-edits')->group(function (): void {
            Route::post('conversations/{conversation}/read', [ConversationController::class, 'read'])->name('conversations.read');
            Route::post('conversations/{conversation}/accept', [ConversationController::class, 'accept'])->name('conversations.accept');
            Route::post('conversations/{conversation}/decline', [ConversationController::class, 'decline'])->name('conversations.decline');
            Route::patch('conversations/{conversation}', [ConversationController::class, 'update'])
                ->middleware(EnsureFeatureEnabled::class.':sig.msg_organize')->name('conversations.update');
            Route::delete('conversations/{conversation}', [ConversationController::class, 'destroy'])->name('conversations.destroy');
            Route::delete('messages/{message}', [MessageController::class, 'destroy'])->name('messages.destroy');
            Route::delete('messages/{message}/reactions', [MessageController::class, 'unreact'])
                ->middleware(EnsureFeatureEnabled::class.':sig.msg_reactions')->name('messages.reactions.destroy');
        });
    });
});

// Chat photos from the private disk (review #5): the signed URL is the credential, bound to the photo, the width and the viewer, who must
// still see the photo when it is fetched.
Route::get('chat-media/{media}/{width}', [ChatMediaController::class, 'show'])
    ->whereNumber('width')
    ->middleware(['signed', 'throttle:public-read'])
    ->name('chat-media.show');
