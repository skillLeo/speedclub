<?php

namespace App\Console\Commands;

use App\Models\Notification;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('notifications:prune')]
#[Description('Delete notifications whose last event is older than the retention period')]
class PruneNotificationsCommand extends Command
{
    public function handle(): int
    {
        $before = now()->subDays(max(1, config()->integer('speedclub.notifications.retention_days')));
        $deleted = 0;

        // In slices, so one run never holds a long lock on a large table.
        do {
            $batch = Notification::query()->where('created_at', '<', $before)->limit(1000)->delete();
            $deleted += $batch;
        } while ($batch === 1000);

        $this->info("Deleted $deleted notifications.");

        return self::SUCCESS;
    }
}
