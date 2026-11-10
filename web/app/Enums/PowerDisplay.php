<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum PowerDisplay: string
{
    use HasLabel;

    case PsKw = 'ps_kw';
    case KwPs = 'kw_ps';
    case Hp = 'hp';
}
