<?php

namespace App\Actions\Social;

use App\Models\User;
use App\Models\VehicleFollow;

/**
 * By id alone, whatever the build's state now.
 */
class UnfollowVehicle
{
    public function handle(User $user, string $vehicleId): void
    {
        VehicleFollow::query()->where('user_id', $user->id)->where('vehicle_id', strtolower($vehicleId))->delete();
    }
}
