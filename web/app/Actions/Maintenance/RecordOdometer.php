<?php

namespace App\Actions\Maintenance;

use App\Models\Vehicle;

/**
 * "Kilometerstand" on MNT-01: the mileage now, as the member reads it (also lower than before: a replaced cluster). km reminders count
 * from it.
 */
class RecordOdometer
{
    public function handle(Vehicle $vehicle, int $km): Vehicle
    {
        return MaintenanceWrites::locked($vehicle, function (Vehicle $locked) use ($km): Vehicle {
            $locked->forceFill(['odometer_km' => $km, 'odometer_at' => now()])->save();

            return $locked;
        });
    }
}
