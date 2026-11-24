<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * M5.5 SHOP-01 (10 §3, m5.5-contract §1): the three fixed categories of the chip row. "Alle" is the absence of a filter, never a case.
 */
enum ShopCategory: string
{
    use HasLabel;

    case Sticker = 'sticker';
    case Apparel = 'apparel';
    case Accessories = 'accessories';
}
