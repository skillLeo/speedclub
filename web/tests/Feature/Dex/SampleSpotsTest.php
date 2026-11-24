<?php

use App\Enums\BadgeMetric;
use App\Models\FeatureFlag;
use App\Models\Spot;
use App\Models\UserSetProgress;
use App\Models\VehicleSpotStat;
use App\Models\XpEvent;
use App\Services\Badges\BadgeMetrics;
use App\Services\Dex\DexSets;
use Database\Seeders\DexSetSeeder;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/DexTestHelpers.php';

/**
 * CR-P5G-07 "samples never earn": a real member may scan a sample car (the card still opens), but the spot is stored uncounted, so it
 * feeds no Dex progress, sets, XP or badges. The staging demo's sample members keep counting among samples.
 */
beforeEach(function () {
    FeatureFlag::query()->updateOrCreate(['key' => 'editorial_samples'], ['enabled' => true, 'description' => 'editorial_samples']);
    $this->seed(DexSetSeeder::class);
});

it('stores a real member\'s spot of a sample car uncounted and pays nothing for it', function (bool $sampleCar, bool $sampleOwner) {
    [$car, $code] = dexCar(dexMember(['is_sample' => $sampleOwner]), ['is_sample' => $sampleCar]);
    $spotter = dexMember();

    dexSpot($spotter, $code)->assertCreated()
        ->assertJsonPath('meta.counted', false)
        ->assertJsonPath('meta.reason', 'sample_car')
        ->assertJsonPath('meta.first_spotter', false);

    $spot = Spot::query()->sole();

    expect($spot->counted)->toBeFalse()
        ->and($spot->is_first_three)->toBeFalse()
        ->and(XpEvent::query()->where('user_id', $spotter->id)->count())->toBe(0)
        ->and(UserSetProgress::query()->where('user_id', $spotter->id)->count())->toBe(0)
        ->and(VehicleSpotStat::query()->find($car->id)?->total ?? 0)->toBe(0);

    // The duplicate within 24 h and the reveal read the same reason.
    dexSpot($spotter, $code)->assertOk()->assertJsonPath('meta.duplicate', true)->assertJsonPath('meta.reason', 'sample_car');
    Sanctum::actingAs($spotter);
    $this->getJson('/api/v1/spots/'.$spot->id)->assertOk()->assertJsonPath('meta.reason', 'sample_car');
})->with([
    'sample car' => [true, false],
    'real car of a sample owner' => [false, true],
]);

it('still counts a sample member\'s spot of a sample car (the staging demo)', function () {
    [, $code] = dexCar(dexMember(['is_sample' => true]), ['is_sample' => true]);

    dexSpot(dexMember(['is_sample' => true]), $code)->assertCreated()->assertJsonPath('meta.counted', true)->assertJsonPath('meta.reason', null);
});

it('leaves sample cars out of badge metrics and set progress, also for spots counted before the fix', function () {
    $spotter = dexMember();
    [$sample] = dexCar(dexMember(), ['is_sample' => true]);
    [$real] = dexCar();
    Spot::factory()->create(['vehicle_id' => $sample->id, 'spotter_id' => $spotter->id, 'counted' => true]);
    Spot::factory()->create(['vehicle_id' => $real->id, 'spotter_id' => $spotter->id, 'counted' => true]);

    expect(app(BadgeMetrics::class)->values(BadgeMetric::CarsSpotted, null, [$spotter->id]))->toBe([$spotter->id => 1]);

    app(DexSets::class)->repair($spotter);
    $brand = UserSetProgress::query()->where('user_id', $spotter->id)->where('set_key', 'like', 'brand-%')->get();

    // Only the real car's make has progress (the sample car's make, if another, none).
    expect($brand->sum('progress'))->toBe(1);
});
