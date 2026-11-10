<?php

namespace App\Console\Commands;

use App\Services\Home\HomeRanking;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('home:rank')]
#[Description('Score every public build for the Für dich stream (vehicle_search.rank_score)')]
class RankHomeFeedCommand extends Command
{
    public function handle(HomeRanking $ranking): int
    {
        $count = $ranking->rankAll();

        if ($count === null) {
            $this->warn('Stopped at the time budget; the current scores stay.');

            return self::FAILURE;
        }

        $this->info("Ranked $count builds.");

        return self::SUCCESS;
    }
}
