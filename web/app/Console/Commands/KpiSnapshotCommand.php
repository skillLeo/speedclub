<?php

namespace App\Console\Commands;

use App\Services\Admin\Kpi\ActivityTracker;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('speedclub:kpi-snapshot')]
#[Description('Store yesterday\'s rolling seven-day active member count for the admin WAU tile (ADR-216)')]
class KpiSnapshotCommand extends Command
{
    public function handle(ActivityTracker $tracker): int
    {
        $count = $tracker->snapshotWeekly();

        $this->info("Weekly active members of yesterday: $count.");

        return self::SUCCESS;
    }
}
