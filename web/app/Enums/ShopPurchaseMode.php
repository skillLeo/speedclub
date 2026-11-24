<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * M5.5 "Im Shop kaufen" (m5.5-contract §3.3): on the Shopify store (product page or cart permalink), or through the sticker designer,
 * because a Car-Sticker without a design cannot be printed (STK-01/05, then STK-06 attaches the design).
 */
enum ShopPurchaseMode: string
{
    use HasLabel;

    case Shopify = 'shopify';
    case StickerDesigner = 'sticker_designer';
}
