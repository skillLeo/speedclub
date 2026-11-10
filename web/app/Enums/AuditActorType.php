<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum AuditActorType: string
{
    use HasLabel;

    case Staff = 'staff';
    case Member = 'member';
    case System = 'system';
}
