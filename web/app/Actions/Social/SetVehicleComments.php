<?php

namespace App\Actions\Social;

use App\Models\Vehicle;

/**
 * [build_comments] (09 §8.5): the owner turns comments on a vehicle's updates on or off. Off hides nothing already written; it only stops
 * new comments (403 comments_disabled).
 */
class SetVehicleComments
{
    public function handle(Vehicle $vehicle, bool $enabled): Vehicle
    {
        $vehicle->forceFill(['comments_enabled' => $enabled])->save();

        return $vehicle;
    }
}
