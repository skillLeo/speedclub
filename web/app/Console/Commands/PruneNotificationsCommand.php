<?php

namespace App\Console\Commands;

use App\Models\Notification;
use App\Services\Notifications\SocialPushLimiter;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('notifications:prune')]
#[Description('Delete notifications whose last event is older than the retention period, and old social push claims')]
class PruneNotificationsCommand extends Command
{
    public function handle(SocialPushLimiter $social): int
    {
        $before = now()->subDays(max(1, config()->integer('speedclub.notifications.retention_days')));
        $deleted = 0;

        // In slices, so one run never holds a long lock on a large table.
        do {
            $batch = Notification::query()->where('created_at', '<', $before)->limit(1000)->delete();
            $deleted += $batch;
        } while ($batch === 1000);

        // M5.9b: the social push claims of past days (SocialPushLimiter keeps a week).
        $claims = $social->prune();

        $this->info("Deleted $deleted notifications and $claims social push claims.");

        return self::SUCCESS;
    }
}
