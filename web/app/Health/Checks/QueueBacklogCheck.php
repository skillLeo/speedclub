<?php

namespace App\Health\Checks;

use Illuminate\Support\Facades\DB;
use Spatie\Health\Checks\Check;
use Spatie\Health\Checks\Result;

/**
 * Jobs waiting in the database queue and the age of the oldest (the cron worker runs every minute): warning when the oldest waits longer
 * than speedclub.doctor.queue_max_backlog_minutes, failed at three times that.
 */
class QueueBacklogCheck extends Check
{
    public function run(): Result
    {
        $row = DB::table('jobs')->whereNull('reserved_at')->where('available_at', '<=', now()->getTimestamp())
            ->selectRaw('COUNT(*) AS waiting, MIN(available_at) AS oldest')->first();
        $waiting = (int) ($row->waiting ?? 0);
        $oldest = is_numeric($row?->oldest) ? (int) $row->oldest : null;
        $minutes = $oldest === null ? 0 : intdiv(max(0, now()->getTimestamp() - $oldest), 60);
        $limit = config()->integer('speedclub.doctor.queue_max_backlog_minutes');
        $result = Result::make((string) $waiting)->meta(['waiting' => $waiting, 'oldest_minutes' => $minutes]);

        return match (true) {
            $minutes >= 3 * $limit => $result->failed("Oldest job waits $minutes minutes."),
            $minutes >= $limit => $result->warning("Oldest job waits $minutes minutes."),
            default => $result->ok(),
        };
    }
}
