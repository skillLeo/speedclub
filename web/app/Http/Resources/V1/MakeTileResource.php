<?php

namespace App\Http\Resources\V1;

use App\Services\Discover\MakeTile;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A text tile of "Marken" (FS-11): make `label.s` and its real count `caption`. No manufacturer mark (03_DESIGN_SYSTEM §8).
 *
 * @property MakeTile $resource
 */
class MakeTileResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** The catalogue make, for the make page DISC-03 of Phase 2. */
            'id' => $this->resource->id,
            'name' => $this->resource->name,
            'slug' => $this->resource->slug,
            /** Public builds the viewer can find, never rounded or padded. */
            'vehicle_count' => $this->resource->vehicleCount,
        ];
    }
}
