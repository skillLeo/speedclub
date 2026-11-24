<?php

use App\Http\Controllers\Admin\Members\MemberWrappedController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use App\Http\Controllers\Admin\Support\RecordLookup;
use Illuminate\Support\Facades\Route;

// ADM-10 tab "Wrapped" (M5.9e admin, m5.9e contract §2): members.view like the whole record, plus support.view for the member's Wrapped
// (the tab, the card PNGs) and support.reply for "Vorschau erzeugen" (MemberWrappedPanel). The atom sits on the route and, for the write,
// in its FormRequest. Generating rewrites (or, without activity, removes) the member's stored Wrapped, so it is a ⚿ write
// (staff.recent-password, ADR-215) behind the atom: a role without it hears 403 before any password prompt. The PNGs are staff-only
// copies of the member API's cards, never cached by a shared cache.
Route::middleware([...AdminRoutes::signedIn(), 'can:members.view', 'can:support.view'])
    ->prefix('members/{member}/wrapped')
    ->name('members.wrapped.')
    ->where(['member' => RecordLookup::MEMBER])
    ->group(function (): void {
        // Each limit counts under a name of its own (the third parameter): an unnamed `throttle:N,M` keys on the staff member alone, so
        // the PNGs a preview shows used up the 10 generations a minute (E2E P5 gate, A5 Wrapped preview answered 429).
        Route::post('/', [MemberWrappedController::class, 'generate'])->middleware(['can:support.reply', 'staff.recent-password', 'throttle:10,1,admin-wrapped-generate'])->name('generate');
        Route::get('{season}/cards/{n}.png', [MemberWrappedController::class, 'card'])
            ->where(['season' => '2[0-9]{3}-(saison|jahr)', 'n' => '[1-9][0-9]?'])
            ->middleware('throttle:120,1,admin-wrapped-card')
            ->name('card');
    });
