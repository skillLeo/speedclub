<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum Visibility: string
{
    use HasLabel;

    case Public = 'public';
    case Unlisted = 'unlisted';
    case Private = 'private';
}
