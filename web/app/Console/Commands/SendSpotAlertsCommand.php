<?php

namespace App\Console\Commands;

use App\Services\Dex\SpotAlerts;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('dex:spot-alerts')]
#[Description('Tell owners, grouped per car and day, how often their car was spotted since the last alert (STREET DEX, m5.9b §4)')]
class SendSpotAlertsCommand extends Command
{
    public function handle(SpotAlerts $alerts): int
    {
        $told = $alerts->run();
        $this->info($told === null ? 'Another run is still sending spot alerts.' : "Wrote spot alerts for $told cars.");

        return self::SUCCESS;
    }
}
