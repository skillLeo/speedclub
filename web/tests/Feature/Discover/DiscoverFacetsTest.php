<?php

use App\Enums\Drivetrain;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/DiscoverM23Helpers.php';

/**
 * M2.3 GET search/facets (m2.3 contract §2): disjunctive counts, visibility as the results, active values with 0.
 */
beforeEach(function () {
    seedModSchema();
    $this->withHeader('Accept-Language', 'de');
});

function m23FacetSeed(): void
{
    m23Build('BMW', 'M4', 'G82', ['year' => 2022, 'power' => 510, 'drivetrain' => 'rear'], [
        ['wheels_tires', ['diameter' => 19, 'diameter_rear' => 20], 'BBS'], ['suspension', ['type' => 'coilover'], 'KW'],
    ]);
    m23Build('BMW', 'M3', 'E46', ['year' => 2004, 'power' => 343, 'drivetrain' => 'rear'], [
        ['wheels_tires', ['diameter' => 18], 'BBS'], ['exhaust', [], 'Eisenmann'],
    ]);
    m23Build('Audi', 'RS6', 'C8', ['year' => 2021, 'power' => 600, 'drivetrain' => 'all'], [
        ['wheels_tires', ['diameter' => 22], 'HRE'], ['suspension', ['type' => 'air'], 'Bilstein'],
    ]);
    m23Build('Volkswagen', 'Golf GTI', 'VII (5G)', ['year' => 2015, 'power' => 230, 'drivetrain' => 'front'], [
        ['wheels_tires', ['diameter' => 18], 'OZ Racing'], ['suspension', ['type' => 'coilover'], 'KW'],
    ]);
}

it('counts every group with the other filters but not its own', function () {
    m23FacetSeed();

    $data = $this->getJson('/api/v1/search/facets?make=bmw&drivetrain[]=rear')->assertOk()->json('data');

    expect($data['total'])->toBe(2)
        ->and($data['total_capped'])->toBeFalse()
        // Makes ignore make, but keep drivetrain: Audi (all) and VW (front) have no rear build.
        ->and(m23Counts($data['makes']))->toBe(['bmw' => 2])
        ->and(m23Counts($data['models']))->toBe(['m3' => 1, 'm4' => 1])
        ->and($data['generations'])->toBeNull()
        // Drivetrain ignores drivetrain, keeps BMW.
        ->and(m23Counts($data['drivetrain']))->toBe(['rear' => 2])
        ->and(m23Counts($data['wheel_diameter']))->toBe(['18' => 1, '19' => 1, '20' => 1])
        ->and(m23Counts($data['wheel_brand']))->toBe(['bbs' => 2])
        ->and(m23Counts($data['exhaust_brand']))->toBe(['eisenmann' => 1])
        ->and($data['year'])->toBe(['min' => 2004, 'max' => 2022])
        ->and($data['power'])->toBe(['min' => 343, 'max' => 510]);

    $all = $this->getJson('/api/v1/search/facets?drivetrain[]=rear')->assertOk()->json('data');
    expect(m23Counts($all['drivetrain']))->toBe(['front' => 1, 'rear' => 2, 'all' => 1])
        ->and($all['models'])->toBeNull();
});

it('keeps the counts of the other options of an active group (BMW next to an active Audi)', function () {
    m23FacetSeed();

    $data = $this->getJson('/api/v1/search/facets?make=audi&suspension_type[]=coilover')->assertOk()->json('data');

    expect($data['total'])->toBe(0)
        ->and(m23Counts($data['makes']))->toBe(['bmw' => 1, 'volkswagen' => 1, 'audi' => 0])
        ->and(m23Counts($data['suspension_type']))->toBe(['coilover' => 0, 'air' => 1]);

    $data = $this->getJson('/api/v1/search/facets?wheel_diameter[]=18')->assertOk()->json('data');

    expect(m23Counts($data['wheel_diameter']))->toBe(['18' => 2, '19' => 1, '20' => 1, '22' => 1])
        ->and(collect($data['wheel_diameter'])->firstWhere('value', '19')['label'])->toBe('19″')
        ->and(m23Counts($data['makes']))->toBe(['bmw' => 1, 'volkswagen' => 1]);
});

it('treats the catalogue as a hierarchy: makes without model and generation, models without generation', function () {
    m23FacetSeed();

    $data = $this->getJson('/api/v1/search/facets?make=bmw&model=m3&generation=e46')->assertOk()->json('data');

    expect(m23Counts($data['makes']))->toBe(['bmw' => 2, 'audi' => 1, 'volkswagen' => 1])
        ->and(m23Counts($data['models']))->toBe(['m3' => 1, 'm4' => 1])
        ->and(m23Counts($data['generations']))->toBe(['e46' => 1])
        ->and($data['total'])->toBe(1);
});

it('labels in the request language, values in the parameters\' form', function () {
    m23FacetSeed();

    $de = $this->getJson('/api/v1/search/facets')->assertOk()->json('data');
    $en = $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/search/facets')->assertOk()->json('data');

    expect(collect($de['drivetrain'])->firstWhere('value', 'all')['label'])->toBe('Allrad')
        ->and(collect($en['drivetrain'])->firstWhere('value', 'all')['label'])->toBe(Drivetrain::All->label('en'))
        ->and(collect($de['suspension_type'])->firstWhere('value', 'coilover')['label'])->toBe('Gewindefahrwerk')
        ->and(collect($en['suspension_type'])->firstWhere('value', 'coilover')['label'])->toBe('Coilovers')
        ->and(collect($de['mod_category'])->firstWhere('value', 'wheels_tires'))->toBe(['value' => 'wheels_tires', 'label' => 'Räder & Reifen', 'count' => 4])
        ->and(array_column($de['mod_category'], 'value'))->toBe(['wheels_tires', 'suspension', 'exhaust']);
});

it('lists the 20 brands with the most builds, then an active one further down', function () {
    foreach (range(1, 22) as $i) {
        foreach (range(1, $i <= 20 ? 2 : 1) as $copy) {
            m23Build('BMW', 'M4', 'G82', [], [['wheels_tires', ['diameter' => 19], sprintf('Felge %02d', $i)]]);
        }
    }

    $data = $this->getJson('/api/v1/search/facets')->assertOk()->json('data');
    expect($data['wheel_brand'])->toHaveCount(20)
        ->and(collect($data['wheel_brand'])->pluck('count')->unique()->all())->toBe([2]);

    $active = $this->getJson('/api/v1/search/facets?wheel_brand[]=felge-22')->assertOk()->json('data');
    expect($active['wheel_brand'])->toHaveCount(21)
        ->and(end($active['wheel_brand']))->toBe(['value' => 'felge-22', 'label' => 'Felge 22', 'count' => 1]);
});

it('counts only what the results show: no private build, no block either way', function () {
    $viewer = User::factory()->create();
    $mine = m23Build('BMW', 'M4', 'G82');
    m23Build('BMW', 'M4', 'G82', ['visibility' => 'private']);
    m23Build('BMW', 'M4', 'G82', ['visibility' => 'unlisted']);
    $blocked = m23Build('Audi', 'RS6', 'C8');
    m23Block($viewer, $blocked->owner);

    $this->getJson('/api/v1/search/facets')->assertOk()->assertJsonPath('data.total', 2)
        ->assertJsonPath('data.makes', [['value' => 'audi', 'label' => 'Audi', 'count' => 1], ['value' => 'bmw', 'label' => 'BMW', 'count' => 1]]);

    Sanctum::actingAs($viewer);

    $this->getJson('/api/v1/search/facets')->assertOk()->assertJsonPath('data.total', 1)
        ->assertJsonPath('data.makes', [['value' => 'bmw', 'label' => 'BMW', 'count' => 1]]);
    $this->getJson('/api/v1/search/vehicles?sort=newest')->assertOk()->assertJsonPath('data.0.id', $mine->id)->assertJsonCount(1, 'data');
});

it('applies the text too, and validates like search/vehicles', function () {
    m23FacetSeed();

    $this->getJson('/api/v1/search/facets?q=m4')->assertOk()->assertJsonPath('data.total', 1)
        ->assertJsonPath('data.makes.0.value', 'bmw');
    $this->getJson('/api/v1/search/facets?make=trabbi')->assertUnprocessable()
        ->assertJsonPath('errors.make.0', 'Diese Marke gibt es im Katalog nicht. Wähle eine Marke aus der Liste.');
    $this->getJson('/api/v1/search/facets?q=%21%21')->assertUnprocessable()->assertJsonValidationErrors('q');
    $this->getJson('/api/v1/search/facets?drivetrain=rear')->assertUnprocessable()->assertJsonValidationErrors('drivetrain');
});

it('reads one query per group, however many builds there are', function () {
    $count = function (): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        test()->getJson('/api/v1/search/facets?make=bmw&model=m4&wheel_diameter[]=19&suspension_brand[]=kw&mod_category[]=suspension')->assertOk();
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $queries;
    };

    m23Build('BMW', 'M4', 'G82', [], [['wheels_tires', ['diameter' => 19], 'BBS'], ['suspension', ['type' => 'coilover'], 'KW']]);
    $few = $count();

    foreach (range(1, 6) as $i) {
        m23Build('BMW', 'M4', 'G82', [], [['wheels_tires', ['diameter' => 19], 'HRE'], ['suspension', ['type' => 'air'], 'KW'], ['exhaust', [], 'Remus']]);
    }

    expect($count())->toBe($few);
});

it('answers ETag and 304', function () {
    m23FacetSeed();
    $etag = $this->getJson('/api/v1/search/facets?make=bmw')->assertOk()->headers->get('ETag');

    $this->withHeader('If-None-Match', (string) $etag)->getJson('/api/v1/search/facets?make=bmw')->assertStatus(304);
});

/**
 * 2,000 public builds with facet rows, as the M2.8 seed: each facet group's query and the filtered search under 150 ms locally.
 */
it('counts facets and filters 2,000 builds within 150 ms per group', function () {
    $catalogs = [m23Catalog('BMW', 'M4', 'G82'), m23Catalog('Audi', 'RS6', 'C8'), m23Catalog('Nissan', 'Skyline GT-R', 'R34'), m23Catalog('Volkswagen', 'Golf GTI', 'VII (5G)')];
    $brands = array_map(fn (string $name): int => m23Brand($name)->id, ['BBS', 'HRE', 'Rays', 'OZ Racing', 'KW', 'Bilstein', 'Akrapovič', 'Remus']);
    $owners = [];

    foreach (array_chunk(range(1, 200), 100) as $chunk) {
        $rows = [];

        foreach ($chunk as $i) {
            $user = User::factory()->make();
            $owners[] = $id = $user->newUniqueId();
            $rows[] = [...$user->getAttributes(), 'id' => $id, 'created_at' => now(), 'updated_at' => now()];
        }

        DB::table('users')->insert($rows);
    }

    foreach (array_chunk(range(0, 1999), 250) as $chunk) {
        $vehicles = [];
        $search = [];
        $facets = [];

        foreach ($chunk as $i) {
            $catalog = $catalogs[$i % 4];
            $vehicle = Vehicle::factory()->published()->make(['owner_id' => $owners[$i % 200], ...$catalog, 'visibility' => 'public']);
            $id = $vehicle->newUniqueId();
            $at = now()->subMinutes($i)->toDateTimeString();
            $vehicles[] = [...$vehicle->getAttributes(), 'id' => $id, 'published_at' => $at, 'created_at' => $at, 'updated_at' => $at];
            $search[] = [
                'vehicle_id' => $id, 'owner_id' => $owners[$i % 200], ...$catalog, 'model_year' => 1990 + $i % 35, 'power_ps' => 100 + $i % 700,
                'drivetrain' => ['front', 'rear', 'all'][$i % 3], 'gearbox' => ['manual', 'automatic'][$i % 2], 'fuel' => 'petrol',
                'wheel_diameter' => 17 + $i % 5, 'mod_category_mask' => $i % 1024, 'search_text' => 'Probe',
                'title_keys' => ' probe ', 'search_keys' => ' probe bauteil'.($i % 50).' ', 'is_public' => true, 'published_at' => $at, 'updated_at' => $at,
            ];
            $facets[] = ['vehicle_id' => $id, 'facet' => 'wheel_diameter', 'value' => (string) (17 + $i % 5)];
            $facets[] = ['vehicle_id' => $id, 'facet' => 'wheel_diameter', 'value' => (string) (18 + $i % 5)];
            $facets[] = ['vehicle_id' => $id, 'facet' => 'wheel_brand', 'value' => (string) $brands[$i % 4]];
            $facets[] = ['vehicle_id' => $id, 'facet' => 'suspension_brand', 'value' => (string) $brands[4 + $i % 2]];
            $facets[] = ['vehicle_id' => $id, 'facet' => 'suspension_type', 'value' => ['coilover', 'air', 'lowering_springs'][$i % 3]];
            $facets[] = ['vehicle_id' => $id, 'facet' => 'exhaust_brand', 'value' => (string) $brands[6 + $i % 2]];
        }

        DB::table('vehicles')->insert($vehicles);
        DB::table('vehicle_search')->insert($search);
        DB::table('vehicle_search_facets')->insert($facets);
    }

    Sanctum::actingAs(User::factory()->create());
    $times = new ArrayObject;
    DB::listen(fn ($query) => $times->append($query->time));
    $slowest = function (string $url) use ($times): array {
        test()->getJson($url)->assertOk();
        $times->exchangeArray([]);
        $started = microtime(true);
        $response = test()->getJson($url)->assertOk();
        $elapsed = microtime(true) - $started;

        return [max($times->getArrayCopy()), $elapsed, $response];
    };

    [$facetQuery, $facetTotal, $facets] = $slowest('/api/v1/search/facets');
    expect($facets->json('data.total'))->toBe(1000)->and($facets->json('data.total_capped'))->toBeTrue()
        ->and($facetQuery)->toBeLessThan(150.0)->and($facetTotal)->toBeLessThan(1.5);

    [$filteredQuery, $filteredTotal] = $slowest('/api/v1/search/facets?make=bmw&wheel_diameter[]=19&wheel_diameter[]=20&suspension_type[]=coilover&power_min=300&q=probe');
    expect($filteredQuery)->toBeLessThan(150.0)->and($filteredTotal)->toBeLessThan(1.5);

    [$searchQuery] = $slowest('/api/v1/search/vehicles?make=bmw&wheel_brand[]=bbs&wheel_diameter[]=19&sort=power&per_page=50');
    expect($searchQuery)->toBeLessThan(150.0);
})->group('perf');
