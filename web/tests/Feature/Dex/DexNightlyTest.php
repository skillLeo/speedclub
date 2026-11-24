<?php

use App\Actions\Account\DeleteAccount;
use App\Enums\Rarity;
use App\Models\BuildScore;
use App\Models\Generation;
use App\Models\Spot;
use App\Models\UserSetProgress;
use App\Models\Vehicle;
use App\Models\VehicleSpotStat;
use App\Services\Dex\DexNightly;
use App\Services\Dex\RarityRules;
use Carbon\CarbonImmutable;
use Database\Seeders\DexSetSeeder;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/DexTestHelpers.php';

/**
 * M5.9b part 2 (m5.9b contract §6): dex:nightly — Dex numbers, rarity tiers (generation counts; Build Score once M5.9c's table exists;
 * ghost shown over the stored tier), stats and set progress repair (also for the spotters of a deleted account's cars), in chunks that a
 * later run resumes, under a cache lock.
 */

/** Runs the night at 03:00 Berlin of the test day until it is done (at most $runs runs). */
function nightlyUntilDone(int $runs = 50): array
{
    test()->travelTo(CarbonImmutable::parse('2026-07-15 03:00', 'Europe/Berlin'));
    $result = null;

    for ($i = 0; $i < $runs; $i++) {
        $result = app(DexNightly::class)->run();

        if (($result['done'] ?? false) === true) {
            break;
        }
    }

    return (array) $result;
}

/** $count published cars of one generation, $visibility public unless given. @return list<Vehicle> */
function nightlyGeneration(int $count, ?Generation $generation = null, string $visibility = 'public'): array
{
    $generation ??= Generation::factory()->create();
    $model = $generation->vehicleModel;

    return Vehicle::factory()->published()->count($count)->create([
        'make_id' => $model->make_id,
        'model_id' => $model->id,
        'generation_id' => $generation->id,
        'visibility' => $visibility,
    ])->all();
}

it('sets the tier of every published car: legend alone in its generation, rare up to five, street above and without a generation', function () {
    [$alone] = nightlyGeneration(1);
    $few = nightlyGeneration(3);
    $many = nightlyGeneration(6);
    $loose = Vehicle::factory()->published()->create(['generation_id' => null]);
    $draft = Vehicle::factory()->create();

    nightlyUntilDone();

    expect($alone->refresh()->rarity)->toBe(Rarity::Legend)
        ->and(collect($few)->map(fn (Vehicle $car) => $car->refresh()->rarity)->unique()->all())->toBe([Rarity::Rare])
        ->and(collect($many)->map(fn (Vehicle $car) => $car->refresh()->rarity)->unique()->all())->toBe([Rarity::Street])
        ->and($loose->refresh()->rarity)->toBe(Rarity::Street)
        ->and($alone->rarity_computed_at)->not->toBeNull()
        ->and($draft->refresh()->rarity)->toBeNull();
});

it('counts an unlisted or private car of the generation once, for itself only', function () {
    $generation = Generation::factory()->create();
    nightlyGeneration(5, $generation);
    [$unlisted] = nightlyGeneration(1, $generation, 'unlisted');

    nightlyUntilDone();

    // Five public cars and the unlisted one itself: six, above "rare".
    expect($unlisted->refresh()->rarity)->toBe(Rarity::Street)
        ->and(Vehicle::query()->where('generation_id', $generation->id)->where('visibility', 'public')->pluck('rarity')->unique()->values()->all())->toBe([Rarity::Rare]);
});

it('keeps the computed tier of a ghost car and shows ghost over it', function () {
    [$owner, $spotter] = [dexMember(), dexMember()];
    [$ghost, $code] = dexCar($owner);
    $ghost->forceFill(['ghost_mode' => true])->save();
    dexSpot($spotter, $code)->assertCreated();

    nightlyUntilDone();

    expect($ghost->refresh()->rarity)->toBe(Rarity::Legend)
        ->and(RarityRules::shown($ghost))->toBe(Rarity::Ghost);
    Sanctum::actingAs($spotter);
    expect($this->getJson("/api/v1/vehicles/{$ghost->id}/dex-card")->assertOk()->json('data.vehicle.rarity'))->toBe('ghost');

    $ghost->forceFill(['ghost_mode' => false])->save();
    expect(RarityRules::shown($ghost->refresh()))->toBe(Rarity::Legend);
});

it('reaches Tuned and Legend by the Build Score of M5.9c\'s build_scores, and by nothing without a score', function () {
    $rules = app(RarityRules::class);
    $scored = Vehicle::factory()->published()->create();
    BuildScore::factory()->for($scored)->total(612)->create();

    expect(Schema::hasTable('build_scores'))->toBeTrue()
        ->and($rules->scores([Vehicle::factory()->published()->create()->id]))->toBe([])
        ->and($rules->scores([$scored->id]))->toBe([$scored->id => 612])
        // The missing-score case: a large generation stays street, whatever the score would be.
        ->and($rules->tier(20, null))->toBe(Rarity::Street)
        ->and($rules->tier(20, 499))->toBe(Rarity::Street)
        ->and($rules->tier(20, 500))->toBe(Rarity::Tuned)
        ->and($rules->tier(20, 850))->toBe(Rarity::Legend)
        ->and($rules->tier(3, 600))->toBe(Rarity::Rare)
        ->and($rules->tier(null, 600))->toBe(Rarity::Tuned)
        ->and($rules->tier(1, null))->toBe(Rarity::Legend)
        ->and($rules->tier(null, null))->toBe(Rarity::Street);

    config(['speedclub.dex.rarity.legend.unique_generation' => false]);
    expect($rules->tier(1, null))->toBe(Rarity::Rare);
});

it('repairs the stats of every car with spots', function () {
    [$car, $code] = dexCar();
    dexSpot(dexMember(), $code)->assertCreated();
    dexSpot(dexMember(), $code)->assertCreated();
    VehicleSpotStat::query()->whereKey($car->id)->update(['total' => 99, 'unique_spotters' => 99]);
    // A removed spot (staff) lowers the numbers at the next night.
    Spot::query()->where('vehicle_id', $car->id)->latest('id')->first()?->delete();

    nightlyUntilDone();

    expect(VehicleSpotStat::query()->find($car->id)?->only(['total', 'unique_spotters']))->toBe(['total' => 1, 'unique_spotters' => 1]);
});

it('repairs the set progress of the spotters of a deleted account\'s cars', function () {
    $this->seed(DexSetSeeder::class);
    $leaving = dexMember();
    $stays = dexMember();
    $city = dexCity('Bochum');
    [, $theirCode] = dexCar($leaving);
    [$other, $otherCode] = dexCar();
    dexSpot($stays, $theirCode, ['city_id' => $city->id])->assertCreated();
    dexSpot($stays, $otherCode, ['city_id' => $city->id])->assertCreated();

    expect(UserSetProgress::query()->where('user_id', $stays->id)->where('set_key', 'stadtkenner')->value('progress'))->toBe(2);

    app(DeleteAccount::class)->handle($leaving);
    // SpotPurger leaves other members' stored progress for the night.
    expect(UserSetProgress::query()->where('user_id', $stays->id)->where('set_key', 'stadtkenner')->value('progress'))->toBe(2);

    nightlyUntilDone();

    expect(UserSetProgress::query()->where('user_id', $stays->id)->where('set_key', 'stadtkenner')->value('progress'))->toBe(1);
    Sanctum::actingAs($stays);
    $sets = collect($this->getJson('/api/v1/me/dex/sets')->assertOk()->json('data'))->keyBy('key');
    expect($sets['stadtkenner']['progress'])->toBe(1)
        ->and($other->refresh()->dex_number)->not->toBeNull();
});

it('keeps a completed set completed when its progress drops', function () {
    $this->seed(DexSetSeeder::class);
    config(['speedclub.dex.sets.city_target' => 1]);
    DB::table('dex_sets')->where('key', 'stadtkenner')->update(['rule_json' => json_encode(['target' => 1])]);
    $stays = dexMember();
    $leaving = dexMember();
    [, $code] = dexCar($leaving);
    dexSpot($stays, $code, ['city_id' => dexCity('Hagen')->id])->assertCreated();
    $completed = UserSetProgress::query()->where('user_id', $stays->id)->where('set_key', 'stadtkenner')->value('completed_at');
    expect($completed)->not->toBeNull();

    app(DeleteAccount::class)->handle($leaving);
    nightlyUntilDone();

    $row = UserSetProgress::query()->where('user_id', $stays->id)->where('set_key', 'stadtkenner')->first();
    expect($row?->progress)->toBe(0)
        ->and($row?->getAttribute('completed_at'))->not->toBeNull();
});

it('assigns a missing Dex number', function () {
    $car = Vehicle::factory()->published()->create();
    DB::table('vehicles')->where('id', $car->id)->update(['dex_number' => null]);

    nightlyUntilDone();

    expect($car->refresh()->dex_number)->toBeInt();
});

it('works in chunks, keeps its place between runs and is done for the day once finished', function () {
    config(['speedclub.dex.nightly.chunk' => 1, 'speedclub.dex.nightly.seconds' => -1]);
    $cars = nightlyGeneration(3);
    $this->travelTo(CarbonImmutable::parse('2026-07-15 03:00', 'Europe/Berlin'));
    $key = DexNightly::stateKey(CarbonImmutable::now());

    // Runs 1-3: numbers (factory cars have none yet), one car per run while the time is up (CR-P5G-12: the step keeps the deadline);
    // run 4: the first car's rarity.
    expect(app(DexNightly::class)->run())->toBe(['done' => false, 'tasks' => ['numbers' => 1]])
        ->and(Cache::get($key))->toBe(['task' => 'numbers', 'cursor' => 'more']);
    app(DexNightly::class)->run();
    expect(app(DexNightly::class)->run())->toBe(['done' => false, 'tasks' => ['numbers' => 1]])
        ->and(Cache::get($key))->toBe(['task' => 'rarity', 'cursor' => null])
        ->and(Vehicle::query()->whereNull('dex_number')->count())->toBe(0);
    app(DexNightly::class)->run();
    $first = collect($cars)->sortBy('id')->first();
    expect(Cache::get($key))->toBe(['task' => 'rarity', 'cursor' => $first->id])
        ->and($first->refresh()->rarity)->toBe(Rarity::Rare)
        ->and(Vehicle::query()->whereNotNull('rarity')->count())->toBe(1);

    $runs = 4;
    do {
        $result = app(DexNightly::class)->run();
        $runs++;
    } while (! $result['done'] && $runs < 30);

    expect($result['done'])->toBeTrue()
        ->and(Vehicle::query()->whereNull('rarity')->count())->toBe(0)
        ->and(Cache::get($key))->toBe(['task' => 'done', 'cursor' => null]);

    // Later runs of the same night do nothing; the next night starts over.
    expect(app(DexNightly::class)->run())->toBe(['done' => true, 'tasks' => []]);
    $this->travelTo(CarbonImmutable::parse('2026-07-16 03:00', 'Europe/Berlin'));
    expect(app(DexNightly::class)->run()['tasks'])->toHaveKey('numbers');
});

it('stops inside a chunk when its time is up and continues after the last car it repaired', function () {
    config(['speedclub.dex.nightly.chunk' => 10, 'speedclub.dex.nightly.seconds' => -1]);
    $cars = collect([dexCar(), dexCar()])->map(function (array $made) {
        dexSpot(dexMember(), $made[1])->assertCreated();
        VehicleSpotStat::query()->whereKey($made[0]->id)->update(['total' => 99]);

        return $made[0];
    })->sortBy('id')->values();
    $this->travelTo(CarbonImmutable::parse('2026-07-15 03:00', 'Europe/Berlin'));
    $key = DexNightly::stateKey(CarbonImmutable::now());
    Cache::put($key, ['task' => 'stats', 'cursor' => null]);

    expect(app(DexNightly::class)->run()['tasks'])->toBe(['stats' => 1])
        ->and(Cache::get($key))->toBe(['task' => 'stats', 'cursor' => $cars[0]->id])
        ->and(VehicleSpotStat::query()->find($cars[0]->id)?->total)->toBe(1)
        ->and(VehicleSpotStat::query()->find($cars[1]->id)?->total)->toBe(99);

    app(DexNightly::class)->run();
    expect(VehicleSpotStat::query()->find($cars[1]->id)?->total)->toBe(1);
});

it('does nothing while another run holds the lock', function () {
    $lock = Cache::lock(DexNightly::LOCK, 120);
    $lock->get();

    try {
        expect(app(DexNightly::class)->run())->toBeNull();
    } finally {
        $lock->release();
    }

    expect(app(DexNightly::class)->run())->toBeArray();
});

it('runs from the scheduler every ten minutes of the Berlin night and through artisan', function () {
    $this->artisan('dex:nightly')->assertSuccessful();

    $event = collect(app(Schedule::class)->events())
        ->first(fn ($event) => str_contains((string) $event->command, 'dex:nightly'));
    expect($event?->expression)->toBe('*/10 * * * *')
        ->and($event?->timezone)->toBe('Europe/Berlin')
        ->and($event?->withoutOverlapping)->toBeTrue();
});
