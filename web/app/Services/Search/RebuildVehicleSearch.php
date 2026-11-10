<?php

namespace App\Services\Search;

use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Idempotent and about one vehicle, so far below the 50 s of the cron worker. One waiting job per vehicle: a burst of edits collapses
 * into it, as it reads the rows when it runs. The uniqueness ends when the work starts, so a change during a rebuild gets its own
 * job, and after uniqueFor at the latest, should a worker die between taking it and pushing.
 */
class RebuildVehicleSearch implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 45;

    /**
     * @var list<int>
     */
    public array $backoff = [60, 300];

    public int $uniqueFor = 300;

    public function __construct(public readonly string $vehicleId) {}

    public function uniqueId(): string
    {
        return $this->vehicleId;
    }

    public function handle(VehicleSearchProjector $projector): void
    {
        $projector->rebuild($this->vehicleId);
    }
}
