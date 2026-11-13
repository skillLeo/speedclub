<?php

namespace App\Enums;

/**
 * SET-09 "Zusammenfassung" (09 §7.12): how often the e-mail digest of unread messages may go out. Daily at 18:00 (Europe/Berlin), or
 * weekly on Mondays at that time, covering everything that piled up since.
 */
enum DigestFrequency: string
{
    case Daily = 'daily';
    case Weekly = 'weekly';
}
