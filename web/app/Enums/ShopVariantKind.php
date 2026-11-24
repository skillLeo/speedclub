<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * M5.5 SHOP-02: what the one chip row of a product's variants shows (Größe, Farbe or Ausführung). The chips are informational unless a
 * variant carries a Shopify variant id (m5.5-contract §3.3).
 */
enum ShopVariantKind: string
{
    use HasLabel;

    case Size = 'size';
    case Colour = 'colour';
    case Variant = 'variant';
}
