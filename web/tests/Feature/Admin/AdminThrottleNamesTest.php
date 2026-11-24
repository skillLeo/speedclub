<?php

use Illuminate\Support\Facades\Route;

/**
 * Gate run 1 (E2E, A5 Wrapped 429): an unnamed `throttle:N,M` keys on the staff member alone, so every unnamed admin limit shared
 * one counter; loading 30 thumbnails could then refuse a moderation decision. Every admin route's throttle carries its own prefix.
 */
it('gives every admin throttle its own counter', function () {
    $unnamed = collect(Route::getRoutes()->getRoutes())
        ->filter(fn ($route) => str_starts_with($route->uri(), 'admin'))
        ->flatMap(fn ($route) => collect($route->gatherMiddleware())
            ->filter(fn ($m) => is_string($m) && preg_match('/^throttle:\d+,\d+$/', $m))
            ->map(fn ($m) => $route->uri().' '.$m))
        ->values()
        ->all();

    expect($unnamed)->toBe([]);
});
