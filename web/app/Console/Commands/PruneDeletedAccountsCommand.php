<?php

namespace App\Console\Commands;

use App\Enums\UserStatus;
use App\Models\User;
use App\Services\Account\HardDeleteAccount;
use App\Services\Privacy\RetentionPolicy;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

#[Signature('accounts:prune')]
#[Description('Queue the hard delete of accounts whose deletion was requested (SET-13, WEB-05) once their 30 days are up')]
class PruneDeletedAccountsCommand extends Command
{
    /**
     * Only queues: each HardDeleteAccount job stays under the worker's 50 s, whatever an account holds (05_ARCHITECTURE §11).
     */
    public function handle(): int
    {
        $days = app(RetentionPolicy::class)->value('accounts_hard_delete_days');

        $ids = User::withTrashed()
            ->where('status', UserStatus::Deactivated)
            ->whereNotNull('deletion_requested_at')
            ->where('deletion_requested_at', '<=', now()->subDays(max(0, $days - 1)))
            ->orderBy('deletion_requested_at')
            ->limit(config()->integer('speedclub.account_deletion.accounts_per_run'))
            ->pluck('id');

        foreach ($ids as $id) {
            HardDeleteAccount::dispatch((string) $id);
        }

        // Overdue: a closed account still here a day after the promised 30 days means the queue or a job is stuck (08 §1).
        $overdue = User::withTrashed()
            ->where('status', UserStatus::Deactivated)
            ->whereNotNull('deletion_requested_at')
            ->where('deletion_requested_at', '<', now()->subDays($days + 1))
            ->count();

        if ($overdue > 0) {
            Log::warning('Account hard deletes are overdue.', ['accounts' => $overdue]);
            $this->warn("{$overdue} accounts are past their {$days} days.");
        }

        $this->info("Queued the hard delete of {$ids->count()} accounts.");

        return self::SUCCESS;
    }
}
