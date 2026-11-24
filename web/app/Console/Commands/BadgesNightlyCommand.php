<?php

namespace App\Console\Commands;

use App\Services\Badges\BadgesNightly;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('badges:nightly')]
#[Description('Awards every badge members reached (retroactive, resumable, stops after 40 s) (m5.9d §2)')]
class BadgesNightlyCommand extends Command
{
    public function handle(BadgesNightly $nightly): int
    {
        $result = $nightly->run();

        if ($result === null) {
            $this->info('Another badges:nightly run is still working.');

            return self::SUCCESS;
        }

        $this->info(($result['done'] ? 'Done for today.' : 'Continues with the next run.')." Members {$result['members']}, badges awarded {$result['awarded']}.");

        return self::SUCCESS;
    }
}
