<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum MediaStatus: string
{
    use HasLabel;

    case Processing = 'processing';
    case Ready = 'ready';
    case Failed = 'failed';
}
