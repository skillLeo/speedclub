<?php

namespace App\Console\Commands;

use App\Services\Search\VehicleSearchProjector;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('search:rebuild')]
#[Description('Rebuild the vehicle_search projection of every published vehicle')]
class RebuildVehicleSearchCommand extends Command
{
    public function handle(VehicleSearchProjector $projector): int
    {
        $this->info("Rebuilt {$projector->rebuildAll()} vehicles.");

        return self::SUCCESS;
    }
}
