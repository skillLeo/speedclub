<?php

namespace App\Actions\Maintenance;

use App\Enums\MaintenanceType;
use App\Models\MaintenanceItem;
use App\Models\Vehicle;

/**
 * MNT-02 "Löschen": the item and its reminders go; its log entries stay in Verlauf without it. Deleting the HU/AU item clears the vehicle's
 * HU/AU month too, so GAR-06 and MNT-01 never disagree.
 */
class DeleteMaintenanceItem
{
    public function handle(Vehicle $vehicle, MaintenanceItem $item): void
    {
        MaintenanceWrites::locked($vehicle, function (Vehicle $locked) use ($item): void {
            $row = MaintenanceItem::query()->whereKey($item->id)->where('vehicle_id', $locked->id)->first();

            if ($row === null) {
                return;
            }

            if ($row->type === MaintenanceType::HuAu) {
                $locked->forceFill(['hu_au_due' => null])->save();
            }

            $row->delete();
        });
    }
}
