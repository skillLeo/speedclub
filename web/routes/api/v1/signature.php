<?php

use App\Http\Controllers\Api\V1\Signature\CompareController;
use App\Http\Controllers\Api\V1\Signature\PlacardController;
use App\Http\Controllers\Api\V1\Signature\ShareCardController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

// M2.7 signature features (m2.7-contract §1). Each is 404 feature_disabled while its sig.* flag is off; on member routes after `member`,
// so a guest still gets 401 first. QR stats, legal status, plate blur and HU/AU live on the routes of their domain.

// VEH-06 and VEH-07: guests included (ADR-124), as both read only what the viewer may see on the vehicle page. A share card is drawn
// with GD when it is not stored yet, so it also counts against the download limit.
Route::middleware(['throttle:browse', 'etag'])->group(function (): void {
    Route::get('compare', CompareController::class)->middleware(EnsureFeatureEnabled::class.':sig.compare')->name('compare');
});

Route::get('vehicles/{id}/share-card.png', ShareCardController::class)
    ->middleware(['throttle:browse', 'throttle:qr-downloads', EnsureFeatureEnabled::class.':sig.share_cards'])
    ->name('vehicles.share-card');

Route::middleware('member')->group(function (): void {
    Route::get('vehicles/{vehicle}/placard.pdf', PlacardController::class)
        ->middleware([EnsureFeatureEnabled::class.':sig.placard_pdf', 'throttle:qr-downloads'])
        ->name('vehicles.placard');
});
