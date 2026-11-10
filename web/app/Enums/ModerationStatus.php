<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum ModerationStatus: string
{
    use HasLabel;

    case Pending = 'pending';
    case Approved = 'approved';
    case Flagged = 'flagged';
    case Rejected = 'rejected';
}
