<?php

namespace App\Console\Commands;

use App\Services\Audit\AuditChain;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

#[Signature('audit:verify')]
#[Description('Walk the audit hash chain and fail when it is broken')]
class AuditVerifyCommand extends Command
{
    /** Result for ADM-44/48. */
    public const RESULT_CACHE_KEY = 'audit:last_verification';

    public function handle(): int
    {
        $result = AuditChain::verify();

        Cache::forever(self::RESULT_CACHE_KEY, [
            'intact' => $result->intact,
            'checked' => $result->checked,
            'broken_at' => $result->brokenAt,
            'failure' => $result->failure,
            'verified_at' => now()->toIso8601String(),
        ]);

        if ($result->intact) {
            $this->info("Audit chain intact, {$result->checked} events checked.");

            return self::SUCCESS;
        }

        Log::critical('Audit chain broken.', ['event' => $result->brokenAt, 'failure' => $result->failure]);
        $this->error("Audit chain broken at event {$result->brokenAt} ({$result->failure}), {$result->checked} events were intact.");

        return self::FAILURE;
    }
}
