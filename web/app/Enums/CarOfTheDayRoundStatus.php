<?php

namespace App\Enums;

/**
 * R4-2.1 (contract-cotd-voting §2.1): a voting round as a member reads it. open until closes_at (17:00), closed until the pick is
 * published at 18:00 (when the next round opens), unavailable when it has fewer than min_candidates or staff decided the day.
 */
enum CarOfTheDayRoundStatus: string
{
    case Open = 'open';
    case Closed = 'closed';
    case Unavailable = 'unavailable';
}
