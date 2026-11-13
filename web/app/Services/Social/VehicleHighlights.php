<?php

namespace App\Services\Social;

use App\Enums\HighlightItemType;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleHighlight;
use Illuminate\Support\Facades\Gate;

/**
 * The owner's pinned highlights of a build (M4.11, VEH-01 "Highlights" rail): in their order, only the items $viewer may see (a hidden
 * or followers-only update, a removed photo drop out). Read by GET vehicles/{id}/highlights and, since M4.9, PublicVehicleResource.
 */
final class VehicleHighlights
{
    /**
     * @return list<VehicleHighlight>
     */
    public function visible(Vehicle $vehicle, ?User $viewer): array
    {
        $rows = $vehicle->highlights()->get();

        if ($rows->isEmpty()) {
            return [];
        }
        $updates = BuildUpdate::query()->whereKey($rows->where('item_type', HighlightItemType::BuildUpdate)->pluck('item_id')->all())->get()->keyBy('id');
        $photos = Media::query()->whereKey($rows->where('item_type', HighlightItemType::Photo)->pluck('item_id')->all())->get()->keyBy('id');
        $shown = [];

        foreach ($rows as $row) {
            $item = $row->item_type === HighlightItemType::BuildUpdate ? $updates->get($row->item_id) : $photos->get($row->item_id);

            if ($item !== null && Gate::forUser($viewer)->allows('view', $item)) {
                $row->setRelation('item', $item);
                $shown[] = $row;
            }
        }

        return $shown;
    }
}
