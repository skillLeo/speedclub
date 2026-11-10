<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum WhoCanMessage: string
{
    use HasLabel;

    case Everyone = 'everyone';
    case Following = 'following';
    case Nobody = 'nobody';
}
