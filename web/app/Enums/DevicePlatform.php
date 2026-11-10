<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum DevicePlatform: string
{
    use HasLabel;

    case Ios = 'ios';
    case Android = 'android';
    case Web = 'web';
}
