<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * M5.5 ADM-67: where the SHOP-01 hero leads, a product or a category.
 */
enum ShopBannerLink: string
{
    use HasLabel;

    case Product = 'product';
    case Category = 'category';
}
