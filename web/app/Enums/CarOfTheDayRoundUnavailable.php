<?php

namespace App\Enums;

/**
 * R4-2.1 (contract-cotd-voting V2, V6): why a day has no vote (or none yet).
 */
enum CarOfTheDayRoundUnavailable: string
{
    case TooFewCandidates = 'too_few_candidates';
    case StaffDecided = 'staff_decided';
    /** The round has opened, but its candidates are still being frozen (a busy first read at 18:00); ask again in a moment. */
    case NotReady = 'not_ready';
}
