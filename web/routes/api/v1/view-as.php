<?php

use App\Http\Controllers\Api\V1\ViewAs\ViewAsController;
use Illuminate\Support\Facades\Route;

// M3.2 view-as (m3.2-contract §3): the read-only tab ends itself. The member group like every authenticated route (ADR-137): under a
// forced password change the tab cannot end itself, the token still expires after 30 minutes and staff end it from the admin.
Route::delete('view-as', [ViewAsController::class, 'destroy'])->middleware(['member', 'throttle:view-as'])->name('view-as.destroy');
