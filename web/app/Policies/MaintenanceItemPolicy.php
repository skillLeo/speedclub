<?php

namespace App\Policies;

use App\Models\MaintenanceItem;
use App\Models\User;
use App\Models\Vehicle;

/**
 * M4.13 (09 §8.8): maintenance is the vehicle owner's alone (VehiclePolicy::maintain). The API authorises on the vehicle and finds the
 * item inside it; this policy says the same for any other caller.
 */
class MaintenanceItemPolicy
{
    public function view(User $user, MaintenanceItem $item): bool
    {
        return $this->owns($user, $item);
    }

    public function update(User $user, MaintenanceItem $item): bool
    {
        return $this->owns($user, $item);
    }

    public function delete(User $user, MaintenanceItem $item): bool
    {
        return $this->owns($user, $item);
    }

    private function owns(User $user, MaintenanceItem $item): bool
    {
        $vehicle = Vehicle::query()->find($item->vehicle_id);

        return $vehicle instanceof Vehicle && (new VehiclePolicy)->maintain($user, $vehicle);
    }
}
