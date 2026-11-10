<?php

namespace App\Policies;

use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;

class ModificationPolicy
{
    public function view(?User $user, Modification $modification): bool
    {
        return ! $modification->trashed() && (new VehiclePolicy)->view($user, $modification->vehicle);
    }

    public function create(User $user, Vehicle $vehicle): bool
    {
        return (new VehiclePolicy)->update($user, $vehicle);
    }

    public function update(User $user, Modification $modification): bool
    {
        return ! $modification->trashed() && (new VehiclePolicy)->update($user, $modification->vehicle);
    }

    public function delete(User $user, Modification $modification): bool
    {
        return ! $modification->trashed() && (new VehiclePolicy)->delete($user, $modification->vehicle);
    }
}
