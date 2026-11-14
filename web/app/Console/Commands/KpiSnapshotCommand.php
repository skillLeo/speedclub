<?php

namespace App\Console\Commands;

use App\Services\Admin\Kpi;
use App\Services\Admin\Kpi\ActivityTracker;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('speedclub:kpi-snapshot')]
#[Description('Store yesterday\'s rolling seven-day active member count (ADR-216) and the Push-Opt-in of the admin dashboard')]
class KpiSnapshotCommand extends Command
{
    public function handle(ActivityTracker $tracker, Kpi $kpi): int
    {
        $count = $tracker->snapshotWeekly();
        $push = $kpi->snapshotPushOptIn();

        $this->info("Weekly active members of yesterday: $count. Push opt-in: {$push['members']} of {$push['base']}.");

        return self::SUCCESS;
    }
}
