<?php

namespace App\Policies;

use App\Models\SpotAlert;
use App\Models\User;

/**
 * M5.9b: grouping state of the owner alert (part 2's job); only the car's owner could ever read it, no endpoint does.
 */
class SpotAlertPolicy
{
    public function view(User $user, SpotAlert $alert): bool
    {
        $vehicle = $alert->vehicle;

        return $vehicle !== null && (new VehiclePolicy)->viewSpotStats($user, $vehicle);
    }
}
