<?php

namespace App\Enums;

/**
 * An internal complaint (Art. 20 DSA): open until a staff member other than the decider rules on it (Phase 3, ADM-24). Upheld keeps the
 * decision, reversed undoes it.
 */
enum AppealStatus: string
{
    case Open = 'open';
    case Upheld = 'upheld';
    case Reversed = 'reversed';
}
