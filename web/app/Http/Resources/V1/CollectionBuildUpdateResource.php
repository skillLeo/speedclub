<?php

namespace App\Http\Resources\V1;

use App\Models\BuildUpdate;
use Illuminate\Http\Request;

/**
 * A saved build update in COL-02 (DQ-1087): the update plus the build it belongs to, so the tile names the car and links to it without a
 * second request. Only built for an update the reader may see, so the reader may see its build too.
 *
 * @property BuildUpdate $resource
 */
class CollectionBuildUpdateResource extends BuildUpdateResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            ...parent::toArray($request),
            'vehicle' => new VehicleRefResource($this->resource->vehicle),
        ];
    }
}
