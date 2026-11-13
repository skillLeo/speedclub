<?php

namespace App\Http\Resources\V1;

use App\Enums\HighlightItemType;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\VehicleHighlight;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An item of the Highlights rail on VEH-01 (09 §8.5): a pinned build update or photo, in the owner's order.
 *
 * @property VehicleHighlight $resource
 */
class HighlightResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $item = $this->resource->relationLoaded('item') ? $this->resource->getRelation('item') : null;

        return [
            'type' => $this->resource->item_type,
            'id' => $this->resource->item_id,
            'position' => $this->resource->position,
            /** Set for type build_update. */
            'build_update' => $this->resource->item_type === HighlightItemType::BuildUpdate && $item instanceof BuildUpdate ? new BuildUpdateResource($item) : null,
            /** Set for type photo. */
            'photo' => $this->resource->item_type === HighlightItemType::Photo && $item instanceof Media ? new MediaResource($item) : null,
        ];
    }
}
