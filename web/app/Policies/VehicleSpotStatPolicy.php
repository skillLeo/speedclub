<?php

namespace App\Policies;

use App\Models\User;
use App\Models\VehicleSpotStat;

/**
 * M5.9b: a car's spot numbers are its owner's alone (VehiclePolicy::viewSpotStats, DEX-06).
 */
class VehicleSpotStatPolicy
{
    public function view(User $user, VehicleSpotStat $stat): bool
    {
        $vehicle = $stat->vehicle;

        return $vehicle !== null && (new VehiclePolicy)->viewSpotStats($user, $vehicle);
    }
}
