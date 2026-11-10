<?php

use App\Http\Controllers\Api\V1\Support\SupportTicketController;
use Illuminate\Support\Facades\Route;

// SET-15 (M2.5). Guests write through WEB-10 /kontakt.
Route::post('support/tickets', [SupportTicketController::class, 'store'])
    ->middleware(['member', 'throttle:support-tickets', 'idempotent'])
    ->name('support.tickets.store');

// M3.4: the member's tickets and the thread with the team's replies (ADM-26); internal notes never leave the admin.
Route::middleware('member')->group(function (): void {
    Route::get('support/tickets', [SupportTicketController::class, 'index'])->name('support.tickets.index');
    Route::get('support/tickets/{ticket}', [SupportTicketController::class, 'show'])->where('ticket', '[0-9A-Za-z]{26}')->name('support.tickets.show');
});

// SET-15b: the member writes again in their own thread; a closed or pending ticket goes back to the team as open. Shares the 5 an hour
// of a new request.
Route::post('support/tickets/{ticket}/messages', [SupportTicketController::class, 'reply'])
    ->middleware(['member', 'throttle:support-tickets', 'idempotent'])
    ->where('ticket', '[0-9A-Za-z]{26}')
    ->name('support.tickets.messages.store');
