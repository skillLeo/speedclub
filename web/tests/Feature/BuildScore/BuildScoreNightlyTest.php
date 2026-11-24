<?php

use App\Enums\BuildScoreRankScope;
use App\Models\BuildScore;
use App\Models\BuildScoreRank;
use App\Models\Generation;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\BuildScore\BuildScoreNightly;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Cache;

require_once __DIR__.'/BuildScoreTestHelpers.php';

/**
 * M5.9c (m5.9c contract §3): build-score:nightly — every score again, ranks by generation and by the owner's Bundesland, only for groups
 * of at least 3 public, non-ghost, non-sample cars; chunked, resumable, under a cache lock.
 */
beforeEach(function () {
    bsFlags();
    $this->travelTo(CarbonImmutable::parse('2026-11-14 01:00', 'Europe/Berlin'));
});

/** Runs the night until it is done (at most $runs runs). */
function bsNight(int $runs = 50): array
{
    $result = null;

    for ($i = 0; $i < $runs; $i++) {
        $result = app(BuildScoreNightly::class)->run();

        if (($result['done'] ?? false) === true) {
            break;
        }
    }

    return (array) $result;
}

/** Cars of one generation with given documented-mod counts (25 points each), owners in $bundesland. @return list<Vehicle> */
function bsGroup(array $mods, ?Generation $generation = null, string $bundesland = 'NW', array $attributes = []): array
{
    $generation ??= Generation::factory()->create();
    $model = $generation->vehicleModel;
    $cars = [];

    foreach ($mods as $count) {
        $car = bsCar(User::factory()->create(['bundesland' => $bundesland]), [
            'make_id' => $model->make_id, 'model_id' => $model->id, 'generation_id' => $generation->id, ...$attributes,
        ]);

        for ($i = 0; $i < $count; $i++) {
            bsMod($car);
        }

        $cars[] = $car;
    }

    return $cars;
}

function bsRank(Vehicle $car, BuildScoreRankScope $scope): ?array
{
    $rank = BuildScoreRank::query()->where('vehicle_id', $car->id)->where('scope', $scope->value)->first();

    return $rank === null ? null : [$rank->rank, $rank->group_size];
}

it('scores every car and ranks a generation of three, best first, ties sharing a rank', function () {
    [$a, $b, $c, $d] = bsGroup([1, 3, 3, 0]);

    $result = bsNight();

    expect($result['done'])->toBeTrue()
        ->and(BuildScore::query()->count())->toBe(4)
        ->and(bsRank($b, BuildScoreRankScope::Generation))->toBe([1, 4])
        ->and(bsRank($c, BuildScoreRankScope::Generation))->toBe([1, 4])
        ->and(bsRank($a, BuildScoreRankScope::Generation))->toBe([3, 4])
        ->and(bsRank($d, BuildScoreRankScope::Generation))->toBe([4, 4])
        ->and(BuildScoreRank::query()->where('vehicle_id', $a->id)->where('scope', 'generation')->value('scope_key'))->toBe((string) $a->generation_id);
});

it('gives no rank in a group under three cars', function () {
    [$a, $b] = bsGroup([1, 2], bundesland: 'HB');

    bsNight();

    expect(bsRank($a, BuildScoreRankScope::Generation))->toBeNull()
        ->and(bsRank($b, BuildScoreRankScope::Bundesland))->toBeNull()
        ->and(BuildScoreRank::query()->count())->toBe(0);
});

it('never counts samples, ghost, private or unlisted cars, or owners who are not active, verified and real', function () {
    $generation = Generation::factory()->create();
    [$a, $b] = bsGroup([1, 2], $generation);
    bsGroup([5], $generation, attributes: ['is_sample' => true]);
    bsGroup([5], $generation, attributes: ['ghost_mode' => true]);
    bsGroup([5], $generation, attributes: ['visibility' => 'private']);
    bsGroup([5], $generation, attributes: ['visibility' => 'unlisted']);
    $sampleOwner = bsGroup([5], $generation)[0];
    $sampleOwner->owner->forceFill(['is_sample' => true])->save();
    $unverified = bsGroup([5], $generation)[0];
    $unverified->owner->forceFill(['email_verified_at' => null])->save();
    $suspended = bsGroup([5], $generation)[0];
    $suspended->owner->forceFill(['status' => 'suspended'])->save();

    bsNight();

    // Two eligible cars: no group.
    expect(BuildScoreRank::query()->count())->toBe(0);

    [$c] = bsGroup([0], $generation);
    app(BuildScoreNightly::class)->restart();
    bsNight();

    expect(bsRank($b, BuildScoreRankScope::Generation))->toBe([1, 3])
        ->and(bsRank($c, BuildScoreRankScope::Generation))->toBe([3, 3])
        ->and(BuildScoreRank::query()->count())->toBe(6);
});

it('ranks by the owner\'s Bundesland across generations', function () {
    [$nrw1] = bsGroup([2], bundesland: 'NW');
    [$nrw2] = bsGroup([1], bundesland: 'NW');
    [$nrw3] = bsGroup([0], bundesland: 'NW');
    [$bavaria] = bsGroup([4], bundesland: 'BY');

    bsNight();

    expect(bsRank($nrw1, BuildScoreRankScope::Bundesland))->toBe([1, 3])
        ->and(bsRank($nrw3, BuildScoreRankScope::Bundesland))->toBe([3, 3])
        ->and(bsRank($bavaria, BuildScoreRankScope::Bundesland))->toBeNull()
        ->and(bsRank($nrw1, BuildScoreRankScope::Generation))->toBeNull();
});

it('works in chunks that later runs resume, and ends with the same ranks', function () {
    config(['speedclub.build_score.nightly.chunk' => 1, 'speedclub.build_score.nightly.seconds' => 0]);
    $cars = bsGroup([3, 2, 1, 0]);

    $first = app(BuildScoreNightly::class)->run();
    expect($first['done'])->toBeFalse()
        ->and($first['tasks'])->toBe(['scores' => 1])
        ->and(Cache::get(BuildScoreNightly::stateKey(CarbonImmutable::now()))['task'])->toBe('scores');

    $runs = 1;

    while (! (app(BuildScoreNightly::class)->run()['done'] ?? false)) {
        $runs++;
        expect($runs)->toBeLessThan(30);
    }

    expect(BuildScore::query()->count())->toBe(4)
        ->and(array_map(fn (Vehicle $car) => bsRank($car, BuildScoreRankScope::Generation), $cars))->toBe([[1, 4], [2, 4], [3, 4], [4, 4]]);

    // Done for the day: another run does nothing.
    expect(app(BuildScoreNightly::class)->run())->toBe(['done' => true, 'tasks' => []]);
});

it('waits while another run holds the lock', function () {
    $lock = Cache::lock(BuildScoreNightly::LOCK, 120);
    $lock->get();

    expect(app(BuildScoreNightly::class)->run())->toBeNull();

    $lock->release();
    expect(app(BuildScoreNightly::class)->run())->not->toBeNull();
});

it('drops the rank of a car that left its group at the next night', function () {
    [$a, $b, $c] = bsGroup([2, 1, 0]);
    bsNight();
    expect(bsRank($c, BuildScoreRankScope::Generation))->toBe([3, 3]);

    $c->forceFill(['visibility' => 'private'])->save();
    $this->travelTo(CarbonImmutable::parse('2026-11-15 01:00', 'Europe/Berlin'));
    bsNight();

    expect(BuildScoreRank::query()->count())->toBe(0);
});

it('runs from the scheduler every five minutes between 00:30 and 01:55 Berlin', function () {
    $event = collect(app(Schedule::class)->events())->first(fn ($event) => str_contains((string) $event->command, 'build-score:nightly'));

    expect($event)->not->toBeNull()
        ->and($event->expression)->toBe('*/5 * * * *')
        ->and($event->timezone)->toBe('Europe/Berlin');
});

it('restarts the night from the command', function () {
    bsGroup([1, 1, 1]);

    $this->artisan('build-score:nightly')->expectsOutputToContain('Done for today.')->assertSuccessful();
    $this->artisan('build-score:nightly --restart')->expectsOutputToContain('Handled: scores 3')->assertSuccessful();
});
