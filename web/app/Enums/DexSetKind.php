<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * M5.9b (contract §1): the kinds of STREET DEX sets. jdm: a fixed list of generations (one slot each); brand: 5 / 10 / 25 cars of one
 * make; city: 10 different cars in one city; season: cars spotted inside a month-day window of the current year.
 */
enum DexSetKind: string
{
    use HasLabel;

    case Jdm = 'jdm';
    case Brand = 'brand';
    case City = 'city';
    case Season = 'season';
}
