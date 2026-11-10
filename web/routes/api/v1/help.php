<?php

use App\Http\Controllers\Api\V1\Help\HelpArticleController;
use Illuminate\Support\Facades\Route;

// SET-14 (M2.5): readable signed out, like the legal documents.
Route::prefix('help')->name('help.')->middleware(['throttle:public-read', 'etag'])->group(function (): void {
    Route::get('/', [HelpArticleController::class, 'index'])->name('index');
    Route::get('{key}', [HelpArticleController::class, 'show'])->where('key', '[a-z0-9][a-z0-9-]{0,63}')->name('show');
});
