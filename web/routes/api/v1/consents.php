<?php

use App\Http\Controllers\Api\V1\Me\ConsentController;
use Illuminate\Support\Facades\Route;

// M3.5 re-consent (ADM-31, 08_LEGAL_COMPLIANCE): open to restricted and unverified members, like the settings.
Route::prefix('me')->name('me.')->middleware('member')->group(function (): void {
    Route::get('consents', [ConsentController::class, 'show'])->name('consents.show');
    Route::post('consents', [ConsentController::class, 'store'])->middleware(['throttle:account-edits', 'idempotent'])->name('consents.store');
});
