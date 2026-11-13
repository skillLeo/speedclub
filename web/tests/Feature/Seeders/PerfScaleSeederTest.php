<?php

use App\Enums\VehicleStatus;
use App\Models\BuildUpdate;
use App\Models\Follow;
use App\Models\Media;
use App\Models\Notification;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleSearch;
use Database\Seeders\DemoSeeder;
use Database\Seeders\PerfScaleSeeder;
use Illuminate\Support\Facades\DB;

/**
 * The scale data of the API performance probes (09_PREMIUM_2_0 §12, M4.0): at a small scale, twice, on top of the demo.
 */
function perfSeedDemo(): void
{
    config(['speedclub.demo.member_password' => 'demo-member-password', 'speedclub.demo.photo_limit' => 0]);
    app(DemoSeeder::class)->setContainer(app())->__invoke();
}

function perfSeed(): void
{
    (new PerfScaleSeeder(vehicles: 24, owners: 6, updates: 60, photosPerVehicle: 2, followsPerOwner: 2, measuringFollows: 3, notifications: 10))
        ->setContainer(app())
        ->run();
}

/**
 * @return array<string, int>
 */
function perfCounts(): array
{
    $owners = User::query()->where('email', 'like', '%@'.PerfScaleSeeder::EMAIL_DOMAIN)->select('id');
    $vehicles = Vehicle::query()->whereIn('owner_id', $owners)->select('id');

    return [
        'users' => User::query()->count(),
        'perf_owners' => User::query()->where('email', 'like', '%@'.PerfScaleSeeder::EMAIL_DOMAIN)->count(),
        'perf_vehicles' => Vehicle::query()->whereIn('owner_id', $owners)->where('status', VehicleStatus::Published)->count(),
        'perf_media' => Media::query()->where('mediable_type', 'vehicle')->whereIn('mediable_id', $vehicles)->count(),
        'perf_specs' => DB::table('vehicle_specs')->whereIn('vehicle_id', $vehicles)->count(),
        'perf_updates' => BuildUpdate::query()->whereIn('vehicle_id', $vehicles)->count(),
        'perf_search' => VehicleSearch::query()->whereIn('vehicle_id', $vehicles)->where('is_public', true)->count(),
        'follows' => Follow::query()->count(),
        'notifications' => Notification::query()->count(),
        'notification_actors' => DB::table('notification_actors')->count(),
        'vehicles' => Vehicle::query()->count(),
    ];
}

it('adds the configured scale on top of the demo and adds nothing when run again', function () {
    perfSeedDemo();
    $demo = perfCounts();
    $lukas = User::query()->where('username', PerfScaleSeeder::MEASURING_MEMBER)->firstOrFail();
    $demoNotifications = Notification::query()->where('notifiable_id', $lukas->id)->count();

    perfSeed();
    $first = perfCounts();

    expect($first['perf_owners'])->toBe(6)
        ->and($first['perf_vehicles'])->toBe(24)
        ->and($first['perf_media'])->toBe(48)
        ->and($first['perf_specs'])->toBe(24)
        ->and($first['perf_updates'])->toBe(60)
        // The projector indexed every perf build as public, so Discover and Für dich read them.
        ->and($first['perf_search'])->toBe(24)
        ->and($first['vehicles'])->toBe($demo['vehicles'] + 24)
        ->and($first['follows'])->toBeGreaterThan($demo['follows']);

    // Five new_follower days and followed_published groups up to ten rows for the measuring member, through Notifier.
    $perfNotifications = Notification::query()->where('notifiable_id', $lukas->id)->count() - $demoNotifications;
    expect($perfNotifications)->toBeGreaterThanOrEqual(6)->toBeLessThanOrEqual(10)
        ->and($lukas->following()->where('email', 'like', '%@'.PerfScaleSeeder::EMAIL_DOMAIN)->count())->toBe(3);

    // Every perf vehicle has a cover among its own photos, and the slugs are those of the catalogue.
    $vehicle = Vehicle::query()->where('public_id', DemoSeeder::publicIdFor(PerfScaleSeeder::vehicleKey(0)))->firstOrFail();
    expect($vehicle->getAttribute('cover_media_id'))->not->toBeNull()
        ->and(Media::query()->whereKey($vehicle->getAttribute('cover_media_id'))->value('mediable_id'))->toBe($vehicle->id)
        ->and($vehicle->slug)->toEndWith('-'.strtolower($vehicle->public_id));

    perfSeed();

    expect(perfCounts())->toBe($first);
});

it('refuses a database without the demo', function () {
    expect(fn () => perfSeed())->toThrow(RuntimeException::class, 'needs the demo seed first');
});

it('runs only on a measuring database, never on the shared dev database', function () {
    expect(PerfScaleSeeder::allowsDatabase('speedclub_perf', false))->toBeTrue()
        ->and(PerfScaleSeeder::allowsDatabase('speedclub_perf_m418', false))->toBeTrue()
        ->and(PerfScaleSeeder::allowsDatabase('speedclub', false))->toBeFalse()
        ->and(PerfScaleSeeder::allowsDatabase('speedclub', true))->toBeFalse()
        ->and(PerfScaleSeeder::allowsDatabase('speedclub_testing_a', true))->toBeTrue()
        ->and(PerfScaleSeeder::allowsDatabase('speedclub_testing_a', false))->toBeFalse()
        ->and(PerfScaleSeeder::allowsDatabase('u379107297_speedclub', false))->toBeFalse();
});

it('refuses production', function () {
    app()->detectEnvironment(fn () => 'production');

    expect(fn () => perfSeed())->toThrow(RuntimeException::class, 'APP_ENV is production');
});
