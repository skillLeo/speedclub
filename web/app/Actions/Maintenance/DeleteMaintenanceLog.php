<?php

namespace App\Actions\Maintenance;

use App\Actions\Media\DeleteMedia;
use App\Models\MaintenanceItem;
use App\Models\MaintenanceLog;
use App\Models\Media;
use App\Models\Vehicle;
use App\Services\Maintenance\MaintenanceItems;

/**
 * Removes a service log entry with its photos (from the private disk); its item's last time falls back to the newest remaining entry.
 */
class DeleteMaintenanceLog
{
    public function __construct(
        private readonly MaintenanceItems $items,
        private readonly DeleteMedia $media,
    ) {}

    public function handle(Vehicle $vehicle, MaintenanceLog $log): void
    {
        $photos = Media::query()->where('mediable_type', $log->getMorphClass())->where('mediable_id', $log->id)->get();

        foreach ($photos as $photo) {
            $this->media->handle($photo);
        }

        MaintenanceWrites::locked($vehicle, function (Vehicle $locked) use ($log): void {
            $row = MaintenanceLog::query()->whereKey($log->id)->where('vehicle_id', $locked->id)->first();

            if ($row === null) {
                return;
            }

            $item = is_string($row->item_id) ? MaintenanceItem::query()->find($row->item_id) : null;
            $row->delete();

            if ($item !== null) {
                $item->setRelation('vehicle', $locked);
                $this->items->logsChanged($item);
            }
        });
    }
}
