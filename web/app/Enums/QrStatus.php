<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum QrStatus: string
{
    use HasLabel;

    case Active = 'active';
    case Revoked = 'revoked';
}
