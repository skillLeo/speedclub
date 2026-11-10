<?php

namespace App\Policies;

use App\Models\User;
use App\Models\VehicleSpec;

class VehicleSpecPolicy
{
    public function view(?User $user, VehicleSpec $spec): bool
    {
        return $spec->vehicle !== null && (new VehiclePolicy)->view($user, $spec->vehicle);
    }

    public function update(User $user, VehicleSpec $spec): bool
    {
        return $spec->vehicle !== null && (new VehiclePolicy)->update($user, $spec->vehicle);
    }
}
