<?php

namespace App\Policies;

use App\Models\MaintenanceLog;
use App\Models\User;
use App\Models\Vehicle;

/**
 * M4.13 (09 §8.8): a service log entry, costs and photos included, is the vehicle owner's alone (VehiclePolicy::maintain).
 */
class MaintenanceLogPolicy
{
    public function view(User $user, MaintenanceLog $log): bool
    {
        return $this->owns($user, $log);
    }

    public function update(User $user, MaintenanceLog $log): bool
    {
        return $this->owns($user, $log);
    }

    public function delete(User $user, MaintenanceLog $log): bool
    {
        return $this->owns($user, $log);
    }

    private function owns(User $user, MaintenanceLog $log): bool
    {
        $vehicle = Vehicle::query()->find($log->vehicle_id);

        return $vehicle instanceof Vehicle && (new VehiclePolicy)->maintain($user, $vehicle);
    }
}
