<?php

namespace App\Console\Commands;

use App\Enums\PrivacyRequestStatus;
use App\Models\PrivacyRequest;
use App\Services\Privacy\RetentionPolicy;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * ADM-47 `privacy_requests_months` (default 36): a completed or rejected GDPR request and its evidence file go that long after it closed.
 * Open requests are never pruned. A batch a day; a backlog clears over the following days.
 */
#[Signature('privacy:prune')]
#[Description('Delete closed GDPR requests and their evidence after the retention period')]
class PrunePrivacyRequestsCommand extends Command
{
    private const BATCH = 500;

    public function handle(RetentionPolicy $retention): int
    {
        $disk = Storage::disk(config()->string('speedclub.media.private_disk'));
        $requests = PrivacyRequest::query()
            ->whereIn('status', [PrivacyRequestStatus::Completed->value, PrivacyRequestStatus::Rejected->value])
            ->where('completed_at', '<', now()->subMonthsNoOverflow($retention->value('privacy_requests_months')))
            ->limit(self::BATCH)
            ->get(['id', 'evidence_path']);

        foreach ($requests as $request) {
            if (is_string($request->evidence_path)) {
                $disk->delete($request->evidence_path);
            }

            $disk->deleteDirectory(config()->string('speedclub.privacy.evidence_directory').'/'.$request->getKey());
        }

        $deleted = PrivacyRequest::query()->whereKey($requests->modelKeys())->delete();
        $this->info("Deleted {$deleted} closed privacy requests.");

        return self::SUCCESS;
    }
}
