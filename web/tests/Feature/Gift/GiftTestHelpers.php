<?php

use App\Models\Block;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Search\VehicleSearchProjector;
use Database\Seeders\BadgeSeeder;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/../Garage/GarageTestHelpers.php';
require_once __DIR__.'/../Dex/DexTestHelpers.php';

/**
 * M5.9d supporting system test helpers, prefixed gift… so they never collide with another file's functions.
 */
function giftMember(array $attributes = []): User
{
    return User::factory()->create(['created_at' => now()->subDays(3), ...$attributes]);
}

function giftBadges(): void
{
    test()->seed(BadgeSeeder::class);
}

/**
 * A public published car with $photos usable photos, a Build Score of $score and its search row.
 *
 * @param  array<string, mixed>  $attributes
 */
function giftCar(?User $owner = null, int $score = 500, int $photos = 4, array $attributes = []): Vehicle
{
    $vehicle = Vehicle::factory()->published()->create(['owner_id' => ($owner ?? giftMember())->id, 'visibility' => 'public', ...$attributes]);

    for ($i = 0; $i < $photos; $i++) {
        Media::factory()->forModel($vehicle)->create(['owner_id' => $vehicle->owner_id]);
    }

    giftScore($vehicle, $score);
    app(VehicleSearchProjector::class)->rebuild($vehicle->id);

    return $vehicle->refresh();
}

function giftScore(Vehicle $vehicle, int $total): void
{
    DB::table('build_scores')->updateOrInsert(['vehicle_id' => $vehicle->id], [
        'total' => $total, 'completeness' => 0, 'documentation' => 0, 'community' => 0, 'journey' => 0, 'stage' => 1,
        'breakdown' => '{}', 'previous_total' => null, 'formula_version' => '1', 'changed_at' => now(), 'computed_at' => now(),
    ]);
}

function giftBlock(User $blocker, User $blocked): void
{
    Block::factory()->create(['blocker_id' => $blocker->id, 'blocked_id' => $blocked->id]);
}
