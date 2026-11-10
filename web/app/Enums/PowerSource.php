<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum PowerSource: string
{
    use HasLabel;

    case Factory = 'factory';
    case Claimed = 'claimed';
    case Measured = 'measured';
}
