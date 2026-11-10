<?php

namespace App\Health\Checks;

use Illuminate\Support\Facades\DB;
use Spatie\Health\Checks\Check;
use Spatie\Health\Checks\Result;

/**
 * Jobs in failed_jobs (ADM-49 retries or forgets them): warning from one, failed from 50.
 */
class FailedJobsCheck extends Check
{
    public function run(): Result
    {
        $count = DB::table(config()->string('queue.failed.table', 'failed_jobs'))->count();
        $result = Result::make((string) $count)->meta(['count' => $count]);

        return match (true) {
            $count >= 50 => $result->failed("$count failed jobs."),
            $count > 0 => $result->warning("$count failed jobs."),
            default => $result->ok(),
        };
    }
}
