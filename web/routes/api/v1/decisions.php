<?php

use App\Http\Controllers\Api\V1\Moderation\AppealController;
use App\Http\Controllers\Api\V1\Moderation\DecisionController;
use Illuminate\Support\Facades\Route;

// M2.6 statements of reasons (Art. 17) and internal complaints (Art. 20). Open under restrictions, a suspension and before verification:
// the member must be able to read why and to appeal (DecisionPolicy).
Route::middleware('member')->group(function (): void {
    // SET-16 "Entscheidungen zu deinen Inhalten".
    Route::get('me/decisions', [DecisionController::class, 'index'])->name('me.decisions.index');
    // SAFE-01.
    Route::get('decisions/{decision}', [DecisionController::class, 'show'])->name('decisions.show');
    Route::post('decisions/{decision}/appeal', [AppealController::class, 'store'])->middleware(['throttle:appeals', 'idempotent'])->name('decisions.appeal');
});
