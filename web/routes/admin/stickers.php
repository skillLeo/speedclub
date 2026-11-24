<?php

use App\Http\Controllers\Admin\Stickers\StickerDesignsController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM "Sticker-Designs" (10 §2.3, m5.4-contract §8; the Vue page comes from admin-builder). Atom stickers.print: the list and the print
// files the print partner downloads by design id. {design} is the ULID or the design id "SD…" from the slug area or the Shopify order.
Route::middleware([...AdminRoutes::signedIn(), 'can:stickers.print'])->prefix('stickers/designs')->name('stickers.designs.')->group(function (): void {
    Route::get('/', [StickerDesignsController::class, 'index'])->name('index');
    Route::middleware('throttle:60,1,admin-stickers-1')->where(['design' => 'SD[0-9A-Za-z]{8}|sd[0-9A-Za-z]{8}|[0-9A-Za-z]{26}'])->group(function (): void {
        Route::get('{design}/print.pdf', [StickerDesignsController::class, 'printPdf'])->name('print-pdf');
        Route::get('{design}/print.svg', [StickerDesignsController::class, 'printSvg'])->name('print-svg');
    });
});
