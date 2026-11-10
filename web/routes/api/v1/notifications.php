<?php

use App\Http\Controllers\Api\V1\Notifications\NotificationController;
use Illuminate\Support\Facades\Route;

// HOME-02 and the badges (M2.2). Open under restrictions and before verification: a member's own rows.
Route::prefix('notifications')->name('notifications.')->middleware('member')->group(function (): void {
    // throttle:browse (300/min per member): the app polls the count every 60 s in the foreground (M2.2 review #7).
    Route::get('/', [NotificationController::class, 'index'])->middleware('throttle:browse')->name('index');
    Route::get('unread-count', [NotificationController::class, 'unreadCount'])->middleware(['throttle:browse', 'etag'])->name('unread-count');
    Route::post('read-all', [NotificationController::class, 'readAll'])->middleware('throttle:notification-reads')->name('read-all');
    Route::patch('{notification}', [NotificationController::class, 'update'])->middleware('throttle:notification-reads')->name('update');
});
