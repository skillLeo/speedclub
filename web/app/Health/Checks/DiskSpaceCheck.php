<?php

namespace App\Health\Checks;

use Spatie\Health\Checks\Check;
use Spatie\Health\Checks\Result;

/**
 * Used space of the volume that holds storage/, from PHP's disk_free_space()/disk_total_space() (no `df`, which a shared host may not
 * allow to run). Warning from 80 %, failed from 90 %. A host that hides the numbers gives a warning, not a failure.
 */
class DiskSpaceCheck extends Check
{
    public function run(): Result
    {
        $path = storage_path();
        $free = @disk_free_space($path);
        $total = @disk_total_space($path);

        if (! is_float($free) || ! is_float($total) || $total <= 0) {
            return Result::make('unknown')->warning('The host does not report the disk usage.');
        }

        $used = (int) round(100 * ($total - $free) / $total);
        $result = Result::make($used.' %')->meta(['used_percent' => $used, 'free_mb' => (int) floor($free / 1048576)]);

        return match (true) {
            $used >= 90 => $result->failed("Disk $used % used."),
            $used >= 80 => $result->warning("Disk $used % used."),
            default => $result->ok(),
        };
    }
}
