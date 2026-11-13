<?php

use App\Http\Controllers\Admin\Comments\CommentsController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-60 Kommentare (09 §10.3, M4.17): read-only overview under moderation.view; decisions go through the comment's case (ADM-21).
Route::middleware([...AdminRoutes::signedIn(), 'can:moderation.view'])->group(function (): void {
    Route::get('comments', CommentsController::class)->name('comments.index');
});
