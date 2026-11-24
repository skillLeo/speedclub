<?php

namespace App\Enums;

/**
 * M5.7 (10 §6.3, m5.7-contract §6): what became of a member's weekly recap: sent on at least one channel, skipped because nothing
 * happened that week, or unreachable (no channel could deliver it).
 */
enum RecapStatus: string
{
    case Sent = 'sent';
    case Skipped = 'skipped';
    case Unreachable = 'unreachable';
}
