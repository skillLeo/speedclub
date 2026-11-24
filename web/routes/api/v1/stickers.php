<?php

use App\Http\Controllers\Api\V1\Stickers\StickerController;
use App\Http\Controllers\Api\V1\Stickers\StickerFileController;
use Illuminate\Support\Facades\Route;

// M5.4 Sticker (10 §2, docs/reports/phase-5/m5.4-contract.md §3). Owner only. Open under a publishing restriction like the QR routes
// (a sticker is no publication on the platform; the custom line is still screened); a suspended owner reads but does not write.
Route::middleware('member')->group(function (): void {
    Route::get('stickers/templates', [StickerController::class, 'templates'])->middleware(['throttle:browse', 'etag'])->name('stickers.templates');
    Route::get('me/stickers', [StickerController::class, 'index'])->name('me.stickers.index');

    Route::prefix('vehicles/{vehicle}')->group(function (): void {
        Route::get('sticker/stats', [StickerController::class, 'stats'])->name('vehicles.sticker.stats');
        Route::get('sticker-design', [StickerController::class, 'show'])->name('vehicles.sticker-design.show');
        Route::put('sticker-design', [StickerController::class, 'update'])->middleware('throttle:sticker-designs')->name('vehicles.sticker-design.update');
        Route::post('sticker-design/preview', [StickerController::class, 'preview'])->middleware('throttle:sticker-previews')->name('vehicles.sticker-design.preview');
        Route::post('sticker-design/validate', [StickerController::class, 'scanTest'])->middleware(['throttle:sticker-validations', 'idempotent'])->name('vehicles.sticker-design.validate');
        Route::get('sticker-design/versions', [StickerController::class, 'versions'])->name('vehicles.sticker-design.versions');
        Route::post('sticker-design/versions/{version}/restore', [StickerController::class, 'restore'])
            ->whereNumber('version')
            ->middleware(['throttle:sticker-designs', 'idempotent'])
            ->name('vehicles.sticker-design.restore');
    });

    Route::prefix('sticker-designs/{design}')->whereUlid('design')->name('sticker-designs.')->group(function (): void {
        Route::middleware('throttle:qr-downloads')->group(function (): void {
            Route::get('preview.svg', [StickerFileController::class, 'preview'])->name('preview');
            Route::get('share.png', [StickerFileController::class, 'share'])->name('share');
            Route::get('print.svg', [StickerFileController::class, 'printSvg'])->name('print-svg');
            Route::get('print.pdf', [StickerFileController::class, 'printPdf'])->name('print-pdf');
            Route::get('print.png', [StickerFileController::class, 'printPng'])->name('print-png');
        });
        Route::post('order-link', [StickerFileController::class, 'orderLink'])->middleware(['throttle:sticker-orders', 'idempotent'])->name('order-link');
    });
});
