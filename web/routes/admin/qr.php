<?php

use App\Http\Controllers\Admin\Qr\QrActionsController;
use App\Http\Controllers\Admin\Qr\QrIndexController;
use App\Http\Controllers\Admin\Qr\QrShowController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use App\Http\Controllers\Admin\Support\RecordLookup;
use Illuminate\Support\Facades\Route;

// ADM-18/19 (m3.2-contract §2): qr.view for the registry and detail; revoke and reissue need qr.revoke and a recent password.
// {qr} is the ULID or the 8-character code printed on the sticker (RecordLookup).
Route::middleware([...AdminRoutes::signedIn(), 'can:qr.view'])->prefix('qr')->name('qr.')->where(['qr' => RecordLookup::QR])->group(function (): void {
    Route::get('/', QrIndexController::class)->name('index');
    Route::get('{qr}', QrShowController::class)->name('show');
    Route::post('{qr}/revoke', [QrActionsController::class, 'revoke'])->middleware(['can:qr.revoke', 'staff.recent-password', 'throttle:30,1'])->name('revoke');
    Route::post('{qr}/reissue', [QrActionsController::class, 'reissue'])->middleware(['can:qr.revoke', 'staff.recent-password', 'throttle:30,1'])->name('reissue');
});
