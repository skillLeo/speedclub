<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * Members of a business (09 §8.10 `business_members`): the owner (the applicant; one per business) manages the team and the profile;
 * staff edit the profile and decide portfolio tags.
 */
enum BusinessRole: string
{
    use HasLabel;

    case Owner = 'owner';
    case Staff = 'staff';
}
