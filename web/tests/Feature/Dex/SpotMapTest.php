<?php

use App\Models\DeCity;
use App\Models\FeatureFlag;
use App\Models\Spot;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Dex\SpotMap;
use App\Services\Showcase\SampleContent;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/DexTestHelpers.php';

/**
 * M5.9b part 2 (m5.9b contract §6): GET spot-map, the public heat map — counted spots between 24 hours and 90 days old, cities whose
 * spots are of at least 5 different cars (SEC-P5G-03), never a vehicle id, ghost cars and cars hiding their cities excluded, cached for
 * an hour.
 */

/** $count counted spots of $vehicle in $city, $hoursAgo old. */
function mapSpots(Vehicle $vehicle, DeCity $city, int $count, int $hoursAgo = 48, array $attributes = []): void
{
    Spot::factory()->count($count)->create([
        'vehicle_id' => $vehicle->id,
        'spotter_id' => fn () => User::factory(),
        'city_id' => $city->id,
        'bundesland' => $city->bundesland,
        'created_at' => now()->subHours($hoursAgo),
        ...$attributes,
    ]);
}

/**
 * One counted spot each of $cars different cars in $city (the first is $first when given), $hoursAgo old.
 *
 * @return list<Vehicle>
 */
function mapCars(DeCity $city, int $cars, int $hoursAgo = 48, ?Vehicle $first = null, array $attributes = []): array
{
    $list = [];

    foreach (range(1, $cars) as $i) {
        $car = $i === 1 && $first !== null ? $first : dexCar()[0];
        mapSpots($car, $city, 1, $hoursAgo, $attributes);
        $list[] = $car;
    }

    return $list;
}

function mapCities(): array
{
    Cache::flush();

    return test()->getJson('/api/v1/spot-map')->assertOk()->json('data.cities');
}

beforeEach(function () {
    [$this->car] = dexCar();
    $this->city = dexCity('Mönchengladbach');
});

it('lists cities with counted spots of at least five cars older than 24 hours, for guests too, without any vehicle', function () {
    $other = dexCity('Krefeld');
    mapCars($this->city, 5, first: $this->car);
    mapCars($other, 5, 72);
    mapSpots(dexCar()[0], $other, 2, 72);

    $response = $this->getJson('/api/v1/spot-map')->assertOk();

    expect($response->json('data.cities'))->toBe([
        ['city_id' => $other->id, 'name' => 'Krefeld', 'bundesland' => 'NW', 'count' => 7],
        ['city_id' => $this->city->id, 'name' => 'Mönchengladbach', 'bundesland' => 'NW', 'count' => 5],
    ])
        ->and($response->json('data.generated_at'))->toBeString()
        ->and(array_keys($response->json('data')))->toBe(['generated_at', 'cities'])
        ->and($response->getContent())->not->toContain($this->car->id)
        ->not->toContain('vehicle')
        ->not->toContain('lat')
        ->and($response->headers->get('ETag'))->not->toBeNull();
});

it('leaves out cities with fewer than five cars, spots younger than 24 hours and older than 90 days', function (int $cars, int $hoursAgo) {
    mapCars($this->city, $cars, $hoursAgo, $this->car);

    expect(mapCities())->toBe([]);
})->with([
    'four cars' => [4, 48],
    'younger than 24 h' => [5, 23],
    'older than 90 days' => [5, 24 * 91],
]);

it('never shows a town for one car, however often it was spotted there, night spots included (SEC-P5G-03)', function () {
    mapSpots($this->car, $this->city, 9);
    mapSpots($this->car, $this->city, 6, 30, ['is_night' => true]);
    mapCars($this->city, 3);

    expect(mapCities())->toBe([]);

    mapCars($this->city, 1);
    expect(mapCities())->toBe([['city_id' => $this->city->id, 'name' => 'Mönchengladbach', 'bundesland' => 'NW', 'count' => 19]]);
});

it('counts only what counts: no uncounted, removed, ghost, hidden-city or deleted cars', function (Closure $spoil) {
    mapCars($this->city, 4, first: $this->car);
    $spoil($this->car, $this->city);

    expect(mapCities())->toBe([]);
})->with([
    'uncounted' => [fn (Vehicle $car, DeCity $city) => mapSpots(dexCar()[0], $city, 1, 48, ['counted' => false])],
    'removed' => [function (Vehicle $car, DeCity $city) {
        mapSpots(dexCar()[0], $city, 1);
        Spot::query()->latest('id')->first()?->delete();
    }],
    'ghost car' => [function (Vehicle $car, DeCity $city) {
        [$ghost] = dexCar(null, ['ghost_mode' => true]);
        mapSpots($ghost, $city, 1);
    }],
    'car hiding its cities' => [function (Vehicle $car, DeCity $city) {
        [$hidden] = dexCar(null, ['hide_spot_cities' => true]);
        mapSpots($hidden, $city, 1);
    }],
    'deleted car' => [function (Vehicle $car, DeCity $city) {
        [$gone] = dexCar();
        mapSpots($gone, $city, 1);
        $gone->delete();
    }],
]);

it('counts night spots in the aggregate and a ghost car drops out at once', function () {
    mapCars($this->city, 3, first: $this->car);
    mapCars($this->city, 2, 30, attributes: ['is_night' => true]);
    expect(mapCities()[0]['count'])->toBe(5);

    $this->car->forceFill(['ghost_mode' => true])->save();
    expect(mapCities())->toBe([]);
});

it('leaves out sample cars while samples are hidden, and caches each visibility apart', function () {
    foreach (range(1, 5) as $i) {
        mapSpots(dexCar(null, ['is_sample' => true])[0], $this->city, 1);
    }

    FeatureFlag::query()->updateOrCreate(['key' => SampleContent::FLAG], ['enabled' => false]);
    expect(mapCities())->toBe([]);

    FeatureFlag::query()->updateOrCreate(['key' => SampleContent::FLAG], ['enabled' => true]);
    expect(mapCities())->toBe([['city_id' => $this->city->id, 'name' => 'Mönchengladbach', 'bundesland' => 'NW', 'count' => 5]]);
});

it('is cached for an hour', function () {
    Cache::flush();
    mapCars($this->city, 5, first: $this->car);
    expect($this->getJson('/api/v1/spot-map')->json('data.cities'))->toHaveCount(1);

    mapCars(dexCity('Viersen'), 5);
    expect($this->getJson('/api/v1/spot-map')->json('data.cities'))->toHaveCount(1);

    $this->travel(61)->minutes();
    expect($this->getJson('/api/v1/spot-map')->json('data.cities'))->toHaveCount(2);

    SpotMap::forget();
    expect(Cache::has(SpotMap::cacheKey(true)) || Cache::has(SpotMap::cacheKey(false)))->toBeFalse();
});

it('answers members the same as guests', function () {
    mapCars($this->city, 5, first: $this->car);
    Cache::flush();
    $guest = $this->getJson('/api/v1/spot-map')->json('data.cities');
    Sanctum::actingAs(dexMember());

    expect($this->getJson('/api/v1/spot-map')->assertOk()->json('data.cities'))->toBe($guest);
});
