<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum PowerUnit: string
{
    use HasLabel;

    case Ps = 'ps';
    case Kw = 'kw';
    case Hp = 'hp';
}
