<?php

use App\Http\Controllers\Admin\Support\AdminRoutes;
use App\Http\Controllers\Admin\Support\Tickets\MacrosController;
use App\Http\Controllers\Admin\Support\Tickets\TicketActionsController;
use App\Http\Controllers\Admin\Support\Tickets\TicketContactController;
use App\Http\Controllers\Admin\Support\Tickets\TicketsBulkController;
use App\Http\Controllers\Admin\Support\Tickets\TicketShowController;
use App\Http\Controllers\Admin\Support\Tickets\TicketsIndexController;
use Illuminate\Support\Facades\Route;

// ADM-25…27 (m3.4-contract §2). Every route needs support.view; replies, notes, status and assignment support.reply; macros
// support.macros. A bulk status change over 100 tickets in 24 h becomes the `support.bulk_status` approval (ADR-214/229).
$ulid = '[0-9A-Za-z]{26}';

Route::middleware([...AdminRoutes::signedIn(), 'can:support.view'])->prefix('support')->name('support.')->group(function () use ($ulid): void {
    Route::get('tickets', TicketsIndexController::class)->name('tickets');
    Route::post('tickets/bulk', TicketsBulkController::class)->middleware(['can:support.reply', 'staff.recent-password', 'throttle:20,1'])->name('tickets.bulk');
    Route::get('tickets/{ticket}', TicketShowController::class)->where('ticket', $ulid)->name('tickets.show');
    // DQ-563: a web contact's full address, audited per opening (JSON only). Personal data: members.view_pii like the member PII
    // reveal (code review M3.3-app MF-B — a moderator holds support.view but no PII atom).
    Route::post('tickets/{ticket}/contact', TicketContactController::class)->middleware(['can:members.view_pii', 'throttle:30,1'])->where('ticket', $ulid)->name('tickets.contact');

    Route::middleware(['can:support.reply', 'throttle:60,1'])->group(function () use ($ulid): void {
        Route::post('tickets/{ticket}/reply', [TicketActionsController::class, 'reply'])->where('ticket', $ulid)->name('tickets.reply');
        Route::post('tickets/{ticket}/notes', [TicketActionsController::class, 'note'])->where('ticket', $ulid)->name('tickets.note');
        Route::patch('tickets/{ticket}', [TicketActionsController::class, 'update'])->where('ticket', $ulid)->name('tickets.update');
    });

    Route::get('macros', [MacrosController::class, 'index'])->name('macros');
    Route::middleware(['can:support.macros', 'throttle:30,1'])->group(function () use ($ulid): void {
        Route::post('macros', [MacrosController::class, 'store'])->name('macros.store');
        Route::patch('macros/{macro}', [MacrosController::class, 'update'])->where('macro', $ulid)->name('macros.update');
        Route::delete('macros/{macro}', [MacrosController::class, 'destroy'])->where('macro', $ulid)->name('macros.destroy');
    });
});
