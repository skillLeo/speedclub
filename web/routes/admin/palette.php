<?php

use App\Http\Controllers\Admin\Palette\PaletteTargetsController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ⌘K actions (09 §10.2, M4.17): the records an action can be run on. Read-only JSON; each kind checks its atom in the controller
// (event/business: moderation.decide, flag: flags.manage).
Route::middleware(AdminRoutes::signedIn())->group(function (): void {
    Route::get('palette/targets/{kind}', PaletteTargetsController::class)->whereIn('kind', ['event', 'business', 'flag'])->middleware('throttle:120,1')->name('palette.targets');
});
