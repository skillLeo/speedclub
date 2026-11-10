<?php

namespace App\Services\Config;

use App\Enums\ConfigKey;
use App\Models\Staff;
use Illuminate\Support\Carbon;

/**
 * What one valid preview token selects for one request: the issuing staff member's own drafts by key (ADM-34). Read-only.
 */
final readonly class PreviewContext
{
    /**
     * @param  array<string, array<string, mixed>>  $payloads  draft payload by ConfigKey value
     */
    public function __construct(public Staff $staff, public array $payloads, public Carbon $expiresAt) {}

    /**
     * @return array<string, mixed>|null
     */
    public function payload(ConfigKey $key): ?array
    {
        return $this->payloads[$key->value] ?? null;
    }
}
