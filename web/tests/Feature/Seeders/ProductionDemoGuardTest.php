<?php

use App\Models\User;
use Database\Seeders\DemoSeeder;
use Database\Seeders\GiftDemoSeeder;
use Database\Seeders\PerfScaleSeeder;

/*
 * M5.11 (docs/DEPLOY_ALLINKL.md §D10): demo data never reaches production. Each seeder refuses on its own (their own tests), and the full
 * `db:seed` of a first deploy must not even call them. This file pins the production side in one place.
 */

it('does not seed the demo from db:seed in production, whatever the staging switch says', function () {
    app()->detectEnvironment(fn () => 'production');
    config(['speedclub.demo.seed_on_staging' => true]);

    expect(DemoSeeder::runsAutomatically())->toBeFalse();
});

it('keeps every demo call of DatabaseSeeder behind runsAutomatically()', function () {
    $source = (string) file_get_contents(base_path('database/seeders/DatabaseSeeder.php'));

    preg_match_all('/(DemoSeeder|ShopSampleSeeder|DemoShowcaseSeeder|GiftDemoSeeder|PerfScaleSeeder)::class/', $source, $calls);

    // Only the two guarded calls (the demo and its shop samples), no showcase, gift or perf seeder.
    expect($calls[1])->toBe(['DemoSeeder', 'ShopSampleSeeder'])
        ->and($source)->toContain('if (DemoSeeder::runsAutomatically()) {');
});

it('lets none of the demo seeders run in production', function (string $seeder) {
    app()->detectEnvironment(fn () => 'production');
    config(['speedclub.demo.member_password' => 'demo-member-password']);

    $instance = $seeder === PerfScaleSeeder::class ? new PerfScaleSeeder(vehicles: 2, owners: 1, updates: 1, photosPerVehicle: 1, followsPerOwner: 1, measuringFollows: 1, notifications: 1) : app($seeder);

    expect(fn () => $instance->setContainer(app())->__invoke())->toThrow(RuntimeException::class, 'production')
        ->and(User::query()->count())->toBe(0);
})->with([DemoSeeder::class, GiftDemoSeeder::class, PerfScaleSeeder::class]);
