<?php

use App\Enums\Bundesland;
use App\Models\Block;
use App\Models\DeCity;
use App\Models\QrCode;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Garage/GarageTestHelpers.php';

/**
 * M5.9b STREET DEX test helpers.
 */

/**
 * A member old enough for their spots to count (contract §2: accounts younger than 24 h do not count).
 *
 * @param  array<string, mixed>  $attributes
 */
function dexMember(array $attributes = []): User
{
    return User::factory()->create(['created_at' => now()->subDays(3), ...$attributes]);
}

/**
 * A published public car with a photo, its active sticker and its search row.
 *
 * @param  array<string, mixed>  $attributes
 * @return array{0: Vehicle, 1: string}
 */
function dexCar(?User $owner = null, array $attributes = []): array
{
    $vehicle = publishedVehicle($owner ?? dexMember(), $attributes);
    $code = QrCode::factory()->create(['vehicle_id' => $vehicle->id])->code;
    app(VehicleSearchProjector::class)->rebuild($vehicle->id);

    return [$vehicle->refresh(), $code];
}

/**
 * POST spots as $spotter.
 *
 * @param  array<string, mixed>  $body
 * @param  array<string, string>  $headers
 */
function dexSpot(User $spotter, string $code, array $body = [], array $headers = []): TestResponse
{
    Sanctum::actingAs($spotter);

    return test()->postJson('/api/v1/spots', ['code' => $code, ...$body], $headers);
}

function dexCity(string $name, Bundesland $bundesland = Bundesland::NW, int $population = 100_000): DeCity
{
    return DeCity::factory()->named($name, $bundesland, $population)->create();
}

function dexBlock(User $blocker, User $blocked): void
{
    Block::factory()->create(['blocker_id' => $blocker->id, 'blocked_id' => $blocked->id]);
}
