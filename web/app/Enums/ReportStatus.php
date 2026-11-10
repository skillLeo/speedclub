<?php

namespace App\Enums;

/**
 * What a reporter sees of the case behind a report (SET-16): received while the case is new, in review, decided once there is a decision.
 */
enum ReportStatus: string
{
    case Received = 'received';
    case InReview = 'in_review';
    case Decided = 'decided';

    public static function of(CaseStatus $status): self
    {
        return match ($status) {
            CaseStatus::New => self::Received,
            CaseStatus::InReview => self::InReview,
            CaseStatus::Decided, CaseStatus::Closed => self::Decided,
        };
    }
}
