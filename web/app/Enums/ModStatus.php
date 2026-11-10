<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum ModStatus: string
{
    use HasLabel;

    case Installed = 'installed';
    case Planned = 'planned';
    case Removed = 'removed';
}
