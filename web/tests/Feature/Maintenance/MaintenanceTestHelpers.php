<?php

use App\Enums\MaintenanceType;
use App\Enums\RestrictionType;
use App\Models\Block;
use App\Models\FeatureFlag;
use App\Models\MaintenanceItem;
use App\Models\MaintenanceLog;
use App\Models\User;
use App\Models\Vehicle;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Garage/GarageTestHelpers.php';

/**
 * M4.13 maintenance test helpers, prefixed mnt… so they never collide with another file's functions.
 */
function mntFlags(array $flags = []): void
{
    foreach ([...['maintenance' => true, 'editorial_samples' => true], ...$flags] as $key => $enabled) {
        FeatureFlag::query()->updateOrCreate(['key' => $key], ['enabled' => $enabled, 'description' => $key]);
    }

    request()->attributes->remove('speedclub.flags');
}

function mntItem(Vehicle $vehicle, MaintenanceType $type = MaintenanceType::OilChange, array $attributes = []): MaintenanceItem
{
    return MaintenanceItem::factory()->type($type)->create(['vehicle_id' => $vehicle->id, ...$attributes]);
}

function mntLog(Vehicle $vehicle, array $attributes = []): MaintenanceLog
{
    return MaintenanceLog::factory()->create(['vehicle_id' => $vehicle->id, ...$attributes]);
}

/**
 * Who asks, for the owner-only maintenance routes: [who, expected status]. Maintenance is private data, not publishing: a publishing
 * restriction and a suspension do not stop the owner.
 *
 * @return array<string, array{0: Closure(User): ?User, 1: int}>
 */
function mntMatrix(int $success): array
{
    return [
        'guest' => [fn (User $owner): ?User => null, 401],
        'owner' => [fn (User $owner): ?User => $owner, $success],
        'owner restricted from publishing' => [function (User $owner): ?User {
            $owner->forceFill(['restrictions' => [RestrictionType::Publishing->value => ['until' => null]]])->save();

            return $owner;
        }, $success],
        'other member' => [fn (User $owner): ?User => User::factory()->create(), 403],
        'member the owner blocked' => [function (User $owner): ?User {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $owner->id, 'blocked_id' => $member->id]);

            return $member;
        }, 403],
        'member who blocked the owner' => [function (User $owner): ?User {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $member->id, 'blocked_id' => $owner->id]);

            return $member;
        }, 403],
    ];
}

function mntActAs(?User $viewer): void
{
    if ($viewer !== null) {
        Sanctum::actingAs($viewer);
    }
}
