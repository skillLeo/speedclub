<?php

namespace App\Services\Audit;

final readonly class AuditVerification
{
    /**
     * @param  'prev_hash'|'hash'|'head'|null  $failure  which comparison failed
     */
    public function __construct(
        public bool $intact,
        public int $checked,
        public ?int $brokenAt = null,
        public ?string $failure = null,
    ) {}
}
