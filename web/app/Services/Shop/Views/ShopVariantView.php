<?php

namespace App\Services\Shop\Views;

/**
 * One chip of SHOP-02's variant row with its own buy link (a cart permalink when it carries a Shopify variant id).
 */
final readonly class ShopVariantView
{
    public function __construct(
        public string $id,
        public string $label,
        public ShopBuyView $buy,
    ) {}
}
