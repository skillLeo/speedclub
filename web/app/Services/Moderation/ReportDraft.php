<?php

namespace App\Services\Moderation;

use App\Enums\IllegalSubReason;
use App\Enums\ReportReason;
use App\Enums\ReportSource;
use App\Models\User;

/**
 * What a notice says, from the app (a member) or WEB-09 (anybody, with optional contact for the confirmation and the outcome).
 */
final readonly class ReportDraft
{
    public function __construct(
        public ReportSource $source,
        public ?User $reporter,
        public ReportReason $reason,
        public ?IllegalSubReason $subReason = null,
        public ?string $details = null,
        public bool $goodFaith = false,
        public bool $messageContext = false,
        public ?string $contactName = null,
        public ?string $contactEmail = null,
        public ?string $contactLocale = null,
    ) {}
}
