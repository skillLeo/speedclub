<?php

namespace App\Console\Commands;

use App\Services\Engagement\WeeklyRecaps;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('recap:weekly')]
#[Description('M5.7: the Sunday recap per member (push, else e-mail; skipped when nothing happened), resumable, ≤ 40 s per run')]
class SendWeeklyRecapsCommand extends Command
{
    public function handle(WeeklyRecaps $recaps): int
    {
        $done = $recaps->run();
        $this->info($done === null ? 'Another run is still sending recaps.' : "Processed $done members.");

        return self::SUCCESS;
    }
}
