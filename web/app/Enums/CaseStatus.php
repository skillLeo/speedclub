<?php

namespace App\Enums;

/**
 * ADM-20 queue tabs. New and in review are open: further reports of the target join the case. Decided carries a decision; closed is a
 * case that ended without one (Phase 3, e.g. the content was deleted before review).
 */
enum CaseStatus: string
{
    case New = 'new';
    case InReview = 'in_review';
    case Decided = 'decided';
    case Closed = 'closed';

    public function isOpen(): bool
    {
        return $this === self::New || $this === self::InReview;
    }
}
