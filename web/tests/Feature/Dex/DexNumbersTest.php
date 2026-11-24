<?php

use App\Models\Vehicle;
use App\Services\Dex\DexNumbers;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/DexTestHelpers.php';

/**
 * M5.9b Dex numbers (m5.9b contract §1): assigned once at the first publish from a row-locked counter, never reused; the seeders'
 * backfill numbers published cars without one in the order of their first publish.
 */
it('numbers a car at its first publish, in order, and keeps the number', function () {
    $owner = dexMember();
    $first = completeDraft($owner);
    $second = completeDraft($owner);
    Sanctum::actingAs($owner);

    $a = $this->postJson("/api/v1/vehicles/{$first->id}/publish")->assertOk()->json('data.dex_number');
    $b = $this->postJson("/api/v1/vehicles/{$second->id}/publish")->assertOk()->json('data.dex_number');
    $again = $this->postJson("/api/v1/vehicles/{$first->id}/publish")->assertOk()->json('data.dex_number');

    expect($a)->toBeInt()->and($b)->toBe($a + 1)->and($again)->toBe($a);
});

it('never reuses a number, also not after a delete or with a counter behind', function () {
    [$car] = dexCar();
    $number = app(DexNumbers::class)->ensure($car);
    $car->delete();

    DB::table('sequence_counters')->where('key', DexNumbers::COUNTER)->update(['value' => 0]);
    [$next] = dexCar();

    expect(app(DexNumbers::class)->ensure($next))->toBe($number + 1);
});

it('backfills published cars in the order of their first publish', function () {
    $late = Vehicle::factory()->published()->create(['published_at' => now()->subDay()]);
    $early = Vehicle::factory()->published()->create(['published_at' => now()->subDays(5)]);
    $draft = Vehicle::factory()->create();

    expect(app(DexNumbers::class)->assignMissing())->toBe(2);

    expect($early->refresh()->dex_number)->toBeLessThan((int) $late->refresh()->dex_number)
        ->and($draft->refresh()->dex_number)->toBeNull()
        ->and(app(DexNumbers::class)->assignMissing())->toBe(0);
});
