<?php

namespace App\Http\Resources\V1;

use App\Models\MaintenanceItem;
use Illuminate\Http\Request;

/**
 * A row of Garage "Nächste Fälligkeiten" and the widget: the item with its vehicle.
 *
 * @property MaintenanceItem $resource
 */
class MaintenanceUpcomingResource extends MaintenanceItemResource
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
