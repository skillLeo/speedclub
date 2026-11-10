<?php

namespace App\Console\Commands;

use App\Services\Notifications\QrMilestones;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('qr:milestones')]
#[Description('Tell owners once when their stickers reached 10, 50, 100, 500 or 1000 scans [SIG sig.qr_stats]')]
class SendQrMilestonesCommand extends Command
{
    public function handle(QrMilestones $milestones): int
    {
        $told = $milestones->run();
        $this->info($told === null ? 'QR stats are switched off.' : "Told $told owners about a scan milestone.");

        return self::SUCCESS;
    }
}
