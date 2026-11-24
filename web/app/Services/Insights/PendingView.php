<?php

namespace App\Services\Insights;

use App\Enums\ViewSource;
use App\Enums\ViewSubject;

/**
 * M5.7: a view that passed every check, ready to be stored. It carries the viewer's hash, never the address, user agent or member id
 * it was made from (a guest's address only as a salted hash for the per-address cap).
 */
final readonly class PendingView
{
    public function __construct(
        public ViewSubject $subject,
        public string $subjectId,
        public string $ownerId,
        public ?string $vehicleId,
        public string $day,
        public ViewSource $source,
        public string $viewerHash,
        // SF-1: for a guest, the hash of the address alone (day's salt), the key of the per-address cap; null for a member.
        public ?string $addressKey = null,
    ) {}
}
