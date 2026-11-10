<?php

namespace App\Policies;

use App\Models\Save;
use App\Models\User;
use App\Models\Vehicle;

class SavePolicy
{
    public function viewAny(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    /**
     * The saved list is private (02_PRODUCT_SPEC §3.5).
     */
    public function view(User $user, Save $save): bool
    {
        return $save->user_id === $user->id;
    }

    public function create(User $user, Vehicle $vehicle): bool
    {
        return $user->isActive()
            && ! $vehicle->isOwnedBy($user)
            && (new VehiclePolicy)->view($user, $vehicle);
    }

    /**
     * Unsaving by vehicle id: any id answers the same, so this only asks who unsaves.
     */
    public function unsave(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function delete(User $user, Save $save): bool
    {
        return $save->user_id === $user->id;
    }
}
