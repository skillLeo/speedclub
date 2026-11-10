<?php

namespace App\Policies;

use App\Models\BuildUpdate;
use App\Models\User;
use App\Models\Vehicle;

class BuildUpdatePolicy
{
    public function view(?User $user, BuildUpdate $update): bool
    {
        return (new VehiclePolicy)->view($user, $update->vehicle)
            && (! $update->hidden || $update->vehicle->isOwnedBy($user));
    }

    /**
     * Owner note (POST vehicles/{id}/updates). Automatic updates come from Actions. A draft has no history yet (ADR-141).
     */
    public function create(User $user, Vehicle $vehicle): bool
    {
        return ! $vehicle->isDraft() && (new VehiclePolicy)->update($user, $vehicle);
    }

    /**
     * Hide or show again. Hiding stays possible under a publishing restriction; the controller refuses showing again, as it does
     * for a vehicle's visibility.
     */
    public function update(User $user, BuildUpdate $update): bool
    {
        return (new VehiclePolicy)->delete($user, $update->vehicle);
    }
}
