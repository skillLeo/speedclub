<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum RestrictionType: string
{
    use HasLabel;

    case Messaging = 'messaging';
    case Publishing = 'publishing';
}
