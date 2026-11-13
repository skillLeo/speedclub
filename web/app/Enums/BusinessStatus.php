<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * Business profiles (09 §8.10, ADR-414): applied (BIZ-02, waiting for ADM-55) → verified (public, badge) or rejected (with a reason; the
 * applicant can change and send it again); a verified business can be suspended by staff (reason, audit, notice) and reinstated. Only
 * a verified business is seen by anybody but its members and staff.
 */
enum BusinessStatus: string
{
    use HasLabel;

    case Applied = 'applied';
    case Verified = 'verified';
    case Rejected = 'rejected';
    case Suspended = 'suspended';

    public function isPublic(): bool
    {
        return $this === self::Verified;
    }
}
