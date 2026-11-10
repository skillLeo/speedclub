<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum UserStatus: string
{
    use HasLabel;

    case Active = 'active';
    case Suspended = 'suspended';
    case Deactivated = 'deactivated';
}
