<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * What a business does, the first half of BIZ-01's "Werkstatt · München" line.
 */
enum BusinessKind: string
{
    use HasLabel;

    case Workshop = 'workshop';
    case Tuner = 'tuner';
    case Detailing = 'detailing';
    case Wrapping = 'wrapping';
    case Paint = 'paint';
    case Dealer = 'dealer';
    case PartsShop = 'parts_shop';
    case Other = 'other';
}
