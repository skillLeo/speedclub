<?php

namespace App\Services\Shop\Views;

use App\Enums\ShopBannerLink;
use App\Enums\ShopCategory;

/**
 * The SHOP-01 hero (m5.5-contract §3.1): the active banner, only while what it links to can be shown.
 */
final readonly class ShopHeroView
{
    public function __construct(
        public string $id,
        public string $title,
        public ?string $subtitle,
        public ShopImageView $image,
        public ShopBannerLink $linkKind,
        public ?ShopCategory $category,
        public ?string $productId,
        public ?string $productSlug,
        public bool $isSample,
    ) {}
}
