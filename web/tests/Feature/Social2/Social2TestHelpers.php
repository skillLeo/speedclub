<?php

use App\Enums\BuildUpdateAudience;
use App\Models\BuildUpdate;
use App\Models\FeatureFlag;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleFollow;

require_once __DIR__.'/../Social/SocialTestHelpers.php';

/**
 * M4.11 Social 2.0 test helpers, prefixed s2… so they never collide with another file's functions.
 */
function s2Flags(array $flags = []): void
{
    foreach ([...['build_reactions' => true, 'mentions' => true, 'collections' => true, 'vehicle_follow' => true, 'build_comments' => false], ...$flags] as $key => $enabled) {
        FeatureFlag::query()->updateOrCreate(['key' => $key], ['enabled' => $enabled, 'description' => $key]);
    }
}

function s2Post(Vehicle $vehicle, array $attributes = []): BuildUpdate
{
    return BuildUpdate::factory()->post()->create(['vehicle_id' => $vehicle->id, 'audience' => BuildUpdateAudience::Vehicle, 'created_at' => now(), ...$attributes]);
}

function s2FollowVehicle(User $user, Vehicle $vehicle): VehicleFollow
{
    return VehicleFollow::factory()->create(['user_id' => $user->id, 'vehicle_id' => $vehicle->id]);
}

/**
 * Every key anywhere in a decoded JSON body, for "never a count" checks.
 *
 * @return list<string>
 */
function s2Keys(mixed $value): array
{
    if (! is_array($value)) {
        return [];
    }

    $keys = [];

    foreach ($value as $key => $child) {
        if (is_string($key)) {
            $keys[] = $key;
        }

        $keys = [...$keys, ...s2Keys($child)];
    }

    return $keys;
}
