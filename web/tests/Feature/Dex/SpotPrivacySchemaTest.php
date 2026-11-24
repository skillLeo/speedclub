<?php

use Database\Seeders\DeCitySeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/DexTestHelpers.php';

/**
 * M5.9b privacy (10 §16.2, m5.9b contract §0, ADR-508): no coordinate column in the STREET DEX tables or vehicles; POST spots refuses
 * coordinates; no answer of the Dex endpoints carries one. The city centroids live only in the public static file.
 */
const DEX_TABLES = ['spots', 'de_cities', 'vehicle_spot_stats', 'dex_sets', 'user_set_progress', 'spot_alerts', 'vehicles'];

const COORDINATE_COLUMN = '/(^|_)(lat|lng|lon|long|latitude|longitude|geo|geohash|point|coord|coords|coordinates|location|position)(_|$)/i';

const COORDINATE_KEY = '/\A(lat|lng|lon|latitude|longitude|geohash|coordinates?|coords)\z/i';

it('has no coordinate column in any spot table or in vehicles', function () {
    $found = [];

    foreach (DEX_TABLES as $table) {
        expect(Schema::hasTable($table))->toBeTrue();

        foreach (Schema::getColumns($table) as $column) {
            if (preg_match(COORDINATE_COLUMN, $column['name']) === 1 || in_array(strtolower((string) $column['type_name']), ['point', 'geometry', 'linestring', 'polygon'], true)) {
                $found[] = "$table.{$column['name']}";
            }
        }
    }

    expect($found)->toBe([]);
});

it('refuses a spot that carries coordinates', function (string $field) {
    [, $code] = dexCar();

    dexSpot(dexMember(), $code, [$field => 51.2277])->assertUnprocessable()->assertJsonValidationErrors([$field]);
})->with(['lat', 'lng', 'latitude', 'longitude', 'lon', 'accuracy']);

it('answers every Dex endpoint without a coordinate', function () {
    $city = dexCity('Düsseldorf');
    $owner = dexMember();
    [$car, $code] = dexCar($owner);
    $spotter = dexMember();
    $spot = dexSpot($spotter, $code, ['city_id' => $city->id])->assertCreated()->json();

    $answers = [
        $spot,
        test()->getJson('/api/v1/spots/'.$spot['data']['spot_id'])->assertOk()->json(),
        test()->getJson('/api/v1/me/dex')->assertOk()->json(),
        test()->getJson('/api/v1/me/dex/sets')->assertOk()->json(),
        test()->getJson("/api/v1/vehicles/{$car->id}/dex-card")->assertOk()->json(),
        test()->getJson('/api/v1/rarity-rules')->assertOk()->json(),
    ];
    Sanctum::actingAs($owner);
    $answers[] = test()->getJson("/api/v1/vehicles/{$car->id}/spot-stats")->assertOk()->json();

    $keys = [];
    array_walk_recursive($answers, function (mixed $value, int|string $key) use (&$keys): void {
        if (is_string($key) && preg_match(COORDINATE_KEY, $key) === 1) {
            $keys[] = $key;
        }
    });

    expect($keys)->toBe([]);
});

it('seeds the German city list without coordinates and keeps the GeoNames ids of the static file', function () {
    $this->seed(DeCitySeeder::class);

    $file = json_decode((string) file_get_contents(public_path('geo/de-cities.json')), true);
    $ids = array_column($file['cities'], 0);

    expect(DB::table('de_cities')->count())->toBe(count($ids))
        ->and(DB::table('de_cities')->where('id', 2934246)->value('name'))->toBe('Düsseldorf')
        ->and(DB::table('de_cities')->where('id', 2934246)->value('bundesland'))->toBe('NW')
        ->and($file['licence'])->toBe('CC BY 4.0');

    // Safe to run again.
    $this->seed(DeCitySeeder::class);
    expect(DB::table('de_cities')->count())->toBe(count($ids));
});
