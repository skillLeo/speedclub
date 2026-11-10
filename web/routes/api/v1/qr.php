<?php

use App\Http\Controllers\Api\V1\Qr\QrCodeController;
use Illuminate\Support\Facades\Route;

Route::middleware('member')->group(function (): void {
    Route::get('me/qr-codes', [QrCodeController::class, 'index'])->name('me.qr-codes.index');

    Route::get('vehicles/{vehicle}/qr', [QrCodeController::class, 'show'])->name('vehicles.qr.show');
    Route::get('vehicles/{vehicle}/qr/stats', [QrCodeController::class, 'stats'])->name('vehicles.qr.stats');

    Route::middleware('throttle:qr-downloads')->group(function (): void {
        Route::get('vehicles/{vehicle}/qr.svg', [QrCodeController::class, 'svg'])->name('vehicles.qr.svg');
        Route::get('vehicles/{vehicle}/qr.png', [QrCodeController::class, 'png'])->name('vehicles.qr.png');
        Route::get('vehicles/{vehicle}/qr.pdf', [QrCodeController::class, 'pdf'])->name('vehicles.qr.pdf');
    });

    // Stays open under a restriction: the policy only stops a suspended member (VehiclePolicy::reissueQr).
    Route::post('vehicles/{vehicle}/qr/reissue', [QrCodeController::class, 'reissue'])
        ->middleware(['throttle:qr-reissues', 'idempotent'])
        ->name('vehicles.qr.reissue');
});

// The same limit as /c/{code}: a resolver is what someone guessing codes would call. A token only excludes the owner from the count.
Route::get('qr/{code}', [QrCodeController::class, 'resolve'])->middleware('throttle:qr')->name('qr.resolve');
