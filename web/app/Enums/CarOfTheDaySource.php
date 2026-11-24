<?php

namespace App\Enums;

/**
 * M5.9d Car of the Day (m5.9d contract §3): picked by the 17:55 job, or chosen by staff (override or skip, audited).
 */
enum CarOfTheDaySource: string
{
    case Auto = 'auto';
    case Staff = 'staff';
}
