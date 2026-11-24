<?php

use App\Actions\Account\DeleteAccount;
use App\Models\Spot;
use App\Models\UserSetProgress;
use App\Models\VehicleSpotStat;
use App\Services\Account\HardDeleteAccount;
use Database\Seeders\DexSetSeeder;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/DexTestHelpers.php';

/**
 * M5.9b account deletion (m5.9b contract §0): the member's spots and the spots of the member's cars go at once with the request, the
 * set progress with them, and the stats of the other cars are recomputed. The hard delete leaves nothing behind either.
 */
it('removes the member\'s spots and the spots of their cars, and recomputes the stats', function () {
    $this->seed(DexSetSeeder::class);
    $leaving = dexMember();
    [$theirCar, $theirCode] = dexCar($leaving);
    [$otherCar, $otherCode] = dexCar();
    $stays = dexMember();

    dexSpot($leaving, $otherCode)->assertCreated();
    dexSpot($stays, $otherCode)->assertCreated();
    dexSpot($stays, $theirCode)->assertCreated();

    expect(VehicleSpotStat::query()->find($otherCar->id)?->unique_spotters)->toBe(2)
        ->and(UserSetProgress::query()->where('user_id', $leaving->id)->exists())->toBeTrue();

    app(DeleteAccount::class)->handle($leaving);

    expect(Spot::withTrashed()->where('spotter_id', $leaving->id)->count())->toBe(0)
        ->and(Spot::withTrashed()->where('vehicle_id', $theirCar->id)->count())->toBe(0)
        ->and(Spot::query()->where('spotter_id', $stays->id)->count())->toBe(1)
        ->and(VehicleSpotStat::query()->find($otherCar->id)?->unique_spotters)->toBe(1)
        ->and(VehicleSpotStat::query()->find($theirCar->id))->toBeNull()
        ->and(UserSetProgress::query()->where('user_id', $leaving->id)->exists())->toBeFalse();

    // The remaining spotter's Dex no longer holds the deleted member's car.
    Sanctum::actingAs($stays);
    expect(array_column(array_column($this->getJson('/api/v1/me/dex')->assertOk()->json('data'), 'vehicle'), 'id'))->toBe([$otherCar->id]);
});

it('cascades at the hard delete', function () {
    $leaving = dexMember();
    [$theirCar, $theirCode] = dexCar($leaving);
    dexSpot(dexMember(), $theirCode)->assertCreated();
    dexSpot($leaving, dexCar()[1])->assertCreated();

    $leaving->forceFill(['status' => 'deactivated', 'deletion_requested_at' => now()->subDays(40)])->save();
    app()->call([new HardDeleteAccount($leaving->id), 'handle']);

    expect(Spot::withTrashed()->count())->toBe(0)
        ->and(VehicleSpotStat::query()->find($theirCar->id))->toBeNull();
});
