<?php

namespace App\Console\Commands;

use App\Services\Notifications\SavedBuildsDigest;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('notifications:saved-builds')]
#[Description('Tell owners how many members saved their builds last week [SIG sig.saved_builds]')]
class SendSavedBuildsDigestCommand extends Command
{
    public function handle(SavedBuildsDigest $digest): int
    {
        $week = $digest->run();
        $this->info($week === null ? 'Saved builds are switched off.' : "Queued the saved-builds digest of $week.");

        return self::SUCCESS;
    }
}
