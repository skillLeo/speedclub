<?php

use App\Enums\ModStatus;
use App\Models\Block;
use App\Models\Brand;
use App\Models\FeatureFlag;
use App\Models\Generation;
use App\Models\Make;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Models\VehicleSpec;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Str;

require_once __DIR__.'/../Garage/GarageTestHelpers.php';

/**
 * M2.3 Discover: builds with specs and installed parts, through the real projector. Catalogue names are fixed here, never the factories'
 * random words.
 */
function m23Catalog(string $make, ?string $model = null, ?string $generation = null, ?int $from = null): array
{
    $makeRow = Make::query()->firstOrCreate(['slug' => Str::slug($make)], ['name' => $make, 'country' => 'DE']);
    $modelRow = $model === null ? null : VehicleModel::query()->firstOrCreate(['make_id' => $makeRow->id, 'slug' => Str::slug($model)], ['name' => $model]);
    $generationRow = $generation === null || $modelRow === null ? null : Generation::query()->firstOrCreate(
        ['model_id' => $modelRow->id, 'slug' => Str::slug($generation)],
        ['name' => $generation, 'year_from' => $from ?? 2000, 'year_to' => null],
    );

    return ['make_id' => $makeRow->id, 'model_id' => $modelRow?->id, 'generation_id' => $generationRow?->id];
}

function m23Brand(string $name): Brand
{
    return Brand::query()->firstOrCreate(['slug' => Str::slug($name)], ['name' => $name]);
}

/**
 * A published, public build in vehicle_search.
 *
 * @param  array{owner?: User, year?: int, power?: int|null, drivetrain?: string, gearbox?: string, fuel?: string, visibility?: string, published_at?: string, updated_at?: string}  $options
 * @param  list<array{0: string, 1: array<string, mixed>, 2?: string|null, 3?: ModStatus}>  $mods  [category, fields, brand name, status]
 */
function m23Build(string $make, ?string $model = null, ?string $generation = null, array $options = [], array $mods = []): Vehicle
{
    $owner = $options['owner'] ?? User::factory()->create();
    $vehicle = publishedVehicle($owner, [
        ...m23Catalog($make, $model, $generation),
        'model_year' => $options['year'] ?? 2020,
        'visibility' => $options['visibility'] ?? 'public',
        'published_at' => $options['published_at'] ?? now(),
    ]);
    $power = array_key_exists('power', $options) ? $options['power'] : 300;
    VehicleSpec::factory()->create([
        'vehicle_id' => $vehicle->id,
        'power_value' => $power,
        'power_unit' => 'ps',
        'power_ps' => $power,
        'drivetrain' => $options['drivetrain'] ?? 'rear',
        'gearbox' => $options['gearbox'] ?? 'manual',
        'fuel' => $options['fuel'] ?? 'petrol',
        'engine_code' => null,
    ]);

    foreach ($mods as $index => $mod) {
        $brand = isset($mod[2]) ? m23Brand($mod[2]) : null;
        modIn($vehicle, $mod[0], $mod[1], [
            'brand_id' => $brand?->id,
            'status' => $mod[3] ?? ModStatus::Installed,
            'sort' => $index + 1,
            'title' => trim(($mod[2] ?? '').' Teil'),
        ]);
    }

    if (isset($options['updated_at'])) {
        Vehicle::query()->whereKey($vehicle->id)->update(['updated_at' => $options['updated_at']]);
    }

    app(VehicleSearchProjector::class)->rebuild($vehicle->id);

    return $vehicle->refresh();
}

/**
 * @return list<string>
 */
function m23Ids(mixed $rows): array
{
    return array_values(array_map(fn (array $row): string => $row['vehicle']['id'] ?? $row['id'], $rows ?? []));
}

/**
 * Vehicle ids of search/vehicles for a query string, all pages.
 *
 * @return list<string>
 */
function m23Search(string $query, int $perPage = 50): array
{
    $ids = [];
    $url = '/api/v1/search/vehicles?per_page='.$perPage.($query === '' ? '' : '&'.$query);

    for ($page = 0; $page < 50; $page++) {
        $response = test()->getJson($url)->assertOk();
        $ids = [...$ids, ...m23Ids($response->json('data'))];
        $cursor = $response->json('meta.next_cursor');

        if ($cursor === null) {
            return $ids;
        }

        $url = '/api/v1/search/vehicles?per_page='.$perPage.($query === '' ? '' : '&'.$query).'&cursor='.$cursor;
    }

    throw new RuntimeException('Too many pages.');
}

function m23Block(User $blocker, User $blocked): void
{
    Block::factory()->create(['blocker_id' => $blocker->id, 'blocked_id' => $blocked->id]);
}

function m23Flag(bool $enabled): void
{
    FeatureFlag::query()->updateOrCreate(['key' => 'sig.similar_builds'], ['enabled' => $enabled]);
}

/**
 * Facet values with their counts: ['bmw' => 2, …].
 *
 * @param  list<array{value: string, count: int}>|null  $facets
 * @return array<string, int>
 */
function m23Counts(?array $facets): array
{
    return array_column($facets ?? [], 'count', 'value');
}
