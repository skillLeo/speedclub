<?php

namespace App\Actions\Social;

use App\Enums\HighlightItemType;
use App\Models\Vehicle;
use App\Models\VehicleHighlight;
use Illuminate\Support\Facades\DB;

/**
 * The owner's Highlights rail (09 §8.5): replaces the whole ordered list, at most 8 build updates or photos of this vehicle (the request
 * checked they belong to it). Permanent; no ephemeral stories.
 */
class SetHighlights
{
    /**
     * @param  list<array{type: string, id: string}>  $items
     */
    public function handle(Vehicle $vehicle, array $items): void
    {
        DB::transaction(function () use ($vehicle, $items): void {
            Vehicle::query()->whereKey($vehicle->id)->lockForUpdate()->value('id');
            VehicleHighlight::query()->where('vehicle_id', $vehicle->id)->delete();

            foreach ($items as $position => $item) {
                $row = new VehicleHighlight([
                    'vehicle_id' => $vehicle->id,
                    'item_type' => HighlightItemType::from($item['type']),
                    'item_id' => strtolower($item['id']),
                    'position' => $position,
                ]);
                $row->forceFill(['created_at' => now()])->save();
            }
        });
    }
}
