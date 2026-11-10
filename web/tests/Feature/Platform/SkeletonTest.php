<?php

use App\Health\Checks\GdWebpCheck;
use App\Health\Checks\StorageLinkCheck;
use Illuminate\Support\Facades\DB;
use Spatie\Health\Checks\Check;
use Spatie\Health\Checks\Checks\UsedDiskSpaceCheck;
use Spatie\Health\Facades\Health;
use Tighten\Ziggy\Ziggy;

it('runs against the MySQL test database', function () {
    expect(DB::connection()->getDriverName())->toBe('mysql')
        ->and(DB::connection()->getDatabaseName())->toStartWith('speedclub_testing');
});

it('registers only shared-hosting safe health checks', function () {
    $checks = Health::registeredChecks()->map(fn (Check $check): string => $check::class);

    expect($checks)->toContain(GdWebpCheck::class, StorageLinkCheck::class)
        ->not->toContain(UsedDiskSpaceCheck::class);
});

it('runs the health checks and stores the results', function () {
    $this->artisan('health:check --no-notification')->assertSuccessful();

    expect(DB::table('health_check_result_history_items')->count())->toBeGreaterThan(0);
});

it('blocks the API docs outside local and staging', function () {
    $this->get('/docs/api')->assertForbidden();

    $this->app->detectEnvironment(fn (): string => 'production');
    $this->get('/docs/api')->assertForbidden();
});

it('serves the API docs on staging', function () {
    $this->app->detectEnvironment(fn (): string => 'staging');

    $this->get('/docs/api')->assertOk();
});

it('exposes only admin routes to the admin bundle', function () {
    $routes = array_keys((new Ziggy)->toArray()['routes']);

    expect($routes)->toContain('login', 'admin.dashboard', 'login.store', 'logout')
        ->not->toContain('spa', 'home');
});
