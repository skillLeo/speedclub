<?php

namespace App\Services\Discover;

use App\Models\Modification;
use App\Models\Vehicle;

/**
 * A row of the wheel-setup table (WheelSetups). The cursor reads its order columns (f, sort_at, id) through __get from the vehicle, which
 * VisibleBuilds::paginate gave them.
 */
final readonly class WheelSetup
{
    public function __construct(
        public Vehicle $vehicle,
        public Modification $wheels,
        public ?Modification $suspension,
    ) {}

    public function __get(string $name): mixed
    {
        return $this->vehicle->getAttribute($name);
    }

    public function __isset(string $name): bool
    {
        return $this->vehicle->getAttribute($name) !== null;
    }
}
