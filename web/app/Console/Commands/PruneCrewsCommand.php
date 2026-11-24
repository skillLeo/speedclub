<?php

namespace App\Console\Commands;

use App\Services\Crews\CrewPurge;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('crews:prune')]
#[Description('Hard-delete crews past their retention, with logo and cover, unless a moderation case or appeal holds them')]
class PruneCrewsCommand extends Command
{
    public function handle(CrewPurge $purge): int
    {
        $this->info('Hard-deleted '.$purge->run().' crews.');

        return self::SUCCESS;
    }
}
