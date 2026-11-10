<?php

namespace App\Actions\Social;

use App\Models\Save;
use App\Models\User;

/**
 * By id alone, whatever the vehicle's state: a build that went private or was deleted can still leave the list.
 */
class UnsaveVehicle
{
    public function handle(User $user, string $vehicleId): void
    {
        Save::query()->where('user_id', $user->id)->where('vehicle_id', $vehicleId)->delete();
    }
}
