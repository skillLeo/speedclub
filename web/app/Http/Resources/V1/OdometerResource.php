<?php

namespace App\Http\Resources\V1;

use App\Models\Vehicle;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @property Vehicle $resource
 */
class OdometerResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'vehicle_id' => $this->resource->id,
            /** @var int|null */
            'km' => $this->resource->getAttribute('odometer_km'),
            /** @var string|null */
            'recorded_at' => $this->resource->getAttribute('odometer_at')?->toIso8601String(),
        ];
    }
}
