<?php

namespace App\Health\Checks;

use App\Console\Commands\AuditVerifyCommand;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Spatie\Health\Checks\Check;
use Spatie\Health\Checks\Result;

/**
 * The last `audit:verify` (daily 02:00, ADR-113): failed when the chain was broken, warning when it never ran or not within 26 hours.
 */
class AuditChainCheck extends Check
{
    public function run(): Result
    {
        $last = Cache::get(AuditVerifyCommand::RESULT_CACHE_KEY);

        if (! is_array($last) || ! is_string($last['verified_at'] ?? null)) {
            return Result::make('never')->meta(['verified' => false])->warning('The audit chain was not verified yet.');
        }

        $at = Carbon::parse($last['verified_at']);
        $result = Result::make($at->toIso8601String())->meta([
            'verified' => true,
            'intact' => (bool) ($last['intact'] ?? false),
            'checked' => (int) ($last['checked'] ?? 0),
            'verified_at' => $at->toIso8601String(),
        ]);

        if (($last['intact'] ?? false) !== true) {
            return $result->failed('The audit chain is broken.');
        }

        return $at->diffInHours(now(), true) >= 26 ? $result->warning('The last verification is older than a day.') : $result->ok();
    }
}
