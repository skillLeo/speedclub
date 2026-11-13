<?php

use App\Http\Controllers\Api\V1\Config\AppConfigController;
use App\Http\Controllers\Api\V1\Config\LegalDocumentController;
use App\Http\Controllers\Api\V1\Config\ReleaseNotesController;
use Illuminate\Support\Facades\Route;

Route::middleware(['throttle:public-read', 'etag'])->group(function (): void {
    Route::get('app-config', [AppConfigController::class, 'show'])->name('app-config');
    Route::get('legal', [LegalDocumentController::class, 'index'])->name('legal.index');
    Route::get('legal/{key}', [LegalDocumentController::class, 'show'])->name('legal.show');
    // SET-25 "Was ist neu" (09 §7.12), from database/data/release_notes.json.
    Route::get('release-notes', [ReleaseNotesController::class, 'index'])->name('release-notes.index');
});
