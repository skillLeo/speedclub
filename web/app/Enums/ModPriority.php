<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * M5.3: the optional priority of a planned mod (10 §5.9).
 */
enum ModPriority: string
{
    use HasLabel;

    case Low = 'low';
    case Normal = 'normal';
    case High = 'high';
}
