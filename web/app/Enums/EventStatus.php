<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * 09 §8.7: draft → pending_review (pre-moderation, ADM-53) or published → cancelled; rejected by staff (or removed by a moderation
 * decision). Only published and cancelled events are seen by anybody but their organiser and staff.
 */
enum EventStatus: string
{
    use HasLabel;

    case Draft = 'draft';
    case PendingReview = 'pending_review';
    case Published = 'published';
    case Cancelled = 'cancelled';
    case Rejected = 'rejected';

    /**
     * Seen by members other than the organiser (a cancelled event stays readable so attendees learn why).
     */
    public function isPublic(): bool
    {
        return $this === self::Published || $this === self::Cancelled;
    }

    /**
     * The organiser can still change it and send it (again) for review.
     */
    public function isEditableDraft(): bool
    {
        return $this === self::Draft || $this === self::Rejected;
    }
}
