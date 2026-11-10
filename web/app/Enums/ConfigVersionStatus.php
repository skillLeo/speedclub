<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum ConfigVersionStatus: string
{
    use HasLabel;

    case Draft = 'draft';
    case Published = 'published';
    case Superseded = 'superseded';
}
