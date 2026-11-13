<?php

use App\Http\Controllers\Api\V1\Diagnostics\ClientErrorController;
use Illuminate\Support\Facades\Route;

// The app's error screens report what broke (RouteErrorBoundary): guests and members, per IP, no personal data.
Route::post('client-errors', ClientErrorController::class)->middleware('throttle:client-errors')->name('client-errors.store');
