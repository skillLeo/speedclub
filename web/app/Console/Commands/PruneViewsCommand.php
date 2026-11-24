<?php

namespace App\Console\Commands;

use App\Services\Insights\ViewRetention;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('views:prune {--salts : Only delete the salts of past days (just after midnight)}')]
#[Description('M5.7: delete raw view events after 90 days, past view salts, old weekly recaps and engagement push claims (≤ 40 s)')]
class PruneViewsCommand extends Command
{
    public function handle(ViewRetention $retention): int
    {
        if ($this->option('salts') === true) {
            $this->info('Removed '.$retention->pruneSalts().' salts.');

            return self::SUCCESS;
        }

        $pruned = $retention->prune();

        $this->info(sprintf(
            'Removed %d view events, %d salts, %d recaps, %d push claims, %d day counters%s.',
            $pruned['view_events'],
            $pruned['view_salts'],
            $pruned['weekly_recaps'],
            $pruned['engagement_push_claims'],
            $pruned['engagement_daily'],
            $pruned['done'] ? '' : ' (time budget used, more tomorrow)',
        ));

        return self::SUCCESS;
    }
}
