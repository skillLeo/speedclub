<?php

use App\Http\Controllers\Admin\Errors\AdminFallbackController;
use Illuminate\Support\Facades\Route;

// DQ-507: unknown admin URLs end here, inside the admin group (web + staff), so the 404 knows the session. Matched after every other route.
// Bounded (SEC-P1-47): a longer path matches no route, so no session ever stores it as the previous URL.
Route::fallback(AdminFallbackController::class)->where('fallbackPlaceholder', '[^?#]{1,200}')->name('fallback');
