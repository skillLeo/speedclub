<?php

use App\Http\Controllers\Api\V1\Config\AppConfigController;
use App\Http\Controllers\Api\V1\Config\LegalDocumentController;
use Illuminate\Support\Facades\Route;

Route::middleware(['throttle:public-read', 'etag'])->group(function (): void {
    Route::get('app-config', [AppConfigController::class, 'show'])->name('app-config');
    Route::get('legal', [LegalDocumentController::class, 'index'])->name('legal.index');
    Route::get('legal/{key}', [LegalDocumentController::class, 'show'])->name('legal.show');
});
