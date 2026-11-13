<?php

namespace App\Actions\Diagnostics;

use App\Models\User;
use Illuminate\Support\Facades\Log;

/**
 * Writes a crash report of the app into storage/logs/client-*.log. The member is named by their id only (ULID), never by name or
 * e-mail; the report holds the route, the error and the device shape, nothing a member typed.
 */
final class RecordClientError
{
    /**
     * @param  array<string, mixed>  $report  ClientErrorRequest::validated()
     */
    public function handle(array $report, ?User $member): void
    {
        Log::channel('client')->warning('client error: '.mb_substr((string) $report['message'], 0, 200), [
            ...$report,
            'member' => $member?->getKey(),
        ]);
    }
}
