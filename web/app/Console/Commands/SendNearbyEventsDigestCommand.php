<?php

namespace App\Console\Commands;

use App\Services\Events\SendNearbyEventsDigest;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('events:nearby-digest {--force : Run outside the Thursday window (support, tests)}')]
#[Description('Weekly "Neue Treffen in deiner Nähe" for members who opted in and chose a home region (M5.6); resumable, ≤ 40 s a run')]
class SendNearbyEventsDigestCommand extends Command
{
    public function handle(SendNearbyEventsDigest $digest): int
    {
        $result = $digest->run(force: (bool) $this->option('force'));

        $this->info($result['due']
            ? "Week {$result['week']}: told {$result['sent']} members, pushed {$result['pushed']} waiting rows".($result['done'] ? ', all members done.' : ', more next run.')
            : 'Outside the Thursday window, nothing to do.');

        return self::SUCCESS;
    }
}
