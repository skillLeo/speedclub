<?php

use App\Http\RateLimits;
use App\Services\Rules\RateLimitOverrides;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/*
 * Code review M3.4-batch MF-2: with the database cache store (the shared-hosting default) every Cache::get is a query, and the
 * overrides were looked up once per limiter at boot (about 39 SELECTs on every request). They are now read once per process (memo),
 * at boot, so requests themselves never query them.
 */

it('reads the rate-limit overrides at most once per process, also with the database cache store', function () {
    config(['cache.default' => 'database']);
    Cache::forgetDriver('database');
    RateLimitOverrides::flush();

    $reads = 0;
    DB::listen(function ($query) use (&$reads): void {
        if (str_starts_with(strtolower(ltrim($query->sql)), 'select') && str_contains($query->sql, 'cache') && str_contains(implode('|', array_map(strval(...), $query->bindings)), RateLimitOverrides::CACHE_KEY)) {
            $reads++;
        }
    });

    // Boot again under the listener: registering every limiter reads the overrides once (before MF-2: one SELECT per limiter).
    RateLimits::register();
    expect($reads)->toBeLessThanOrEqual(1);

    // Requests of the same process never read them again.
    $this->getJson('/api/v1/catalog/makes')->assertOk();
    $this->getJson('/api/v1/discover')->assertOk();
    expect($reads)->toBeLessThanOrEqual(1);
});

it('applies a published override without a new process after remember()', function () {
    $default = config()->integer('speedclub.rate_limits.reports.max');
    RateLimitOverrides::flush();
    expect(RateLimitOverrides::maxFor('reports', $default))->toBeNull();

    RateLimitOverrides::remember(['reports' => $default * 2]);

    expect(RateLimitOverrides::maxFor('reports', $default))->toBe($default * 2);
});
