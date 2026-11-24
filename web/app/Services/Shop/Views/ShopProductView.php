<?php

namespace App\Services\Shop\Views;

use App\Enums\ShopCategory;
use App\Enums\ShopPurchaseMode;
use App\Enums\ShopVariantKind;

/**
 * A product as SHOP-01 (card fields) and SHOP-02 (all fields) show it, whichever catalogue driver read it (m5.5-contract §2, §3).
 */
final readonly class ShopProductView
{
    /**
     * @param  list<ShopImageView>  $images
     * @param  list<ShopVariantView>  $variants
     */
    public function __construct(
        public string $id,
        public string $slug,
        public string $title,
        public ?string $description,
        public ShopCategory $category,
        public int $priceCents,
        public string $currency,
        public ShopPurchaseMode $purchaseMode,
        public bool $isSample,
        public array $images,
        public ShopVariantKind $variantKind,
        public array $variants,
        public ShopBuyView $buy,
    ) {}

    public function image(): ?ShopImageView
    {
        return $this->images[0] ?? null;
    }
}
