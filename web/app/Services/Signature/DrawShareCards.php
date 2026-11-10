<?php

namespace App\Services\Signature;

use App\Models\Vehicle;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Draws the missing share cards of a vehicle and removes outdated ones (ShareCards::drawAll). Two PNGs of a 1080 px photo: a few seconds,
 * well under the worker's 50 s.
 */
final class DrawShareCards implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 45;

    public function __construct(public readonly string $vehicleId) {}

    public function uniqueId(): string
    {
        return 'share:'.$this->vehicleId;
    }

    public function handle(ShareCards $cards): void
    {
        $vehicle = Vehicle::withTrashed()->with(ShareCards::RELATIONS)->find($this->vehicleId);

        if ($vehicle !== null) {
            $cards->drawAll($vehicle);
        }
    }
}
