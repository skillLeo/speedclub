<?php

namespace App\Console\Commands;

use App\Services\Approvals\Approvals;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('approvals:expire')]
#[Description('End four-eyes requests older than 24 hours and remove export files past their download window (ADR-214)')]
class ExpireApprovalsCommand extends Command
{
    public function handle(Approvals $approvals): int
    {
        $done = $approvals->expire();

        $this->info("Expired {$done['expired']} requests, ended {$done['interrupted']} interrupted runs, removed {$done['files_removed']} export files.");

        return self::SUCCESS;
    }
}
