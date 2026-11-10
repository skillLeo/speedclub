<?php

namespace App\Console\Commands;

use App\Actions\Moderation\LiftExpiredRestrictions;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

/**
 * Every 15 minutes (routes/console.php): a suspension or restriction whose `until` has passed is lifted for good, so the member shows
 * again wherever lists filter on `status = active` (M2.6 review #1).
 */
#[Signature('moderation:lift-expired-suspensions')]
#[Description('Lift suspensions and restrictions whose end date has passed (audited)')]
class LiftExpiredSuspensionsCommand extends Command
{
    public function handle(LiftExpiredRestrictions $lift): int
    {
        $this->info('Lifted: '.$lift->handle().'.');

        return self::SUCCESS;
    }
}
