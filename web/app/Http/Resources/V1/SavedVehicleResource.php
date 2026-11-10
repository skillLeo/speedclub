<?php

namespace App\Http\Resources\V1;

use App\Models\Vehicle;
use App\Support\PivotTime;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A row of PROF-05: the card the feeds show (FeedVehicleResource, owner row included), plus when the member saved it. Read from
 * savedVehicles(), so `pivot` holds the save. Composed rather than extended, so the OpenAPI export names this schema.
 *
 * @property Vehicle $resource
 */
class SavedVehicleResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var mixed $pivot */
        $pivot = $this->resource->getRelationValue('pivot');

        return [
            ...(new FeedVehicleResource($this->resource))->toArray($request),
            /** When the member saved the build, ISO 8601. */
            'saved_at' => PivotTime::iso($pivot?->getAttribute('created_at')),
        ];
    }
}
