<?php

namespace App\Enums;

/**
 * R4-2.3: set by staff only. `hidden`: a DSA remove_content decision (HideCrew, or a report decided that way) took the crew out of every
 * list and page but its own members'; `removed`: staff deleted a hidden crew (RemoveCrew), kept soft-deleted for an appeal (RestoreCrew).
 */
enum CrewStatus: string
{
    case Active = 'active';
    case Hidden = 'hidden';
    case Removed = 'removed';
}
