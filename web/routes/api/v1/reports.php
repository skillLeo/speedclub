<?php

use App\Http\Controllers\Api\V1\Moderation\ReportController;
use Illuminate\Support\Facades\Route;

// M2.6 DSA notice and action (Art. 16). A safety tool: `member` without verified-member, open under restrictions and a suspension
// (ReportPolicy). Guests report on the web, WEB-09 /melden (routes/web.php).
Route::middleware('member')->group(function (): void {
    Route::post('reports', [ReportController::class, 'store'])->middleware(['throttle:reports', 'idempotent'])->name('reports.store');
    // SET-16 "Meine Meldungen".
    Route::get('me/reports', [ReportController::class, 'index'])->name('me.reports.index');
});
