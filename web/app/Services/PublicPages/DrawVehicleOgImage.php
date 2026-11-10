<?php

namespace App\Services\PublicPages;

use App\Models\Vehicle;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;

final class DrawVehicleOgImage extends OgImageJob implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    public function __construct(public readonly string $vehicleId) {}

    public function uniqueId(): string
    {
        return 'vehicle:'.$this->vehicleId;
    }

    protected function subject(): ?Vehicle
    {
        return Vehicle::withTrashed()->with(OgImages::VEHICLE_RELATIONS)->find($this->vehicleId);
    }
}
