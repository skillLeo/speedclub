<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum ThemePreference: string
{
    use HasLabel;

    case Carbon = 'carbon';
    case Black = 'black';
    case Light = 'light';
    case System = 'system';
}
