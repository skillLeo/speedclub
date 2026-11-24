<?php

namespace App\Services\Shop\Views;

use App\Enums\ShopCategory;
use App\Enums\ShopCategoryStatus;

/**
 * One chip of SHOP-01: "Alle" (category null) or a category, with the real number of products its list returns (to hide empty chips)
 * and whether it opens at all (R4-3.2: a coming_soon chip counts 0).
 */
final readonly class ShopCategoryCount
{
    public function __construct(
        public ?ShopCategory $category,
        public int $count,
        public ShopCategoryStatus $status = ShopCategoryStatus::Available,
    ) {}

    public function key(): string
    {
        return $this->category === null ? 'all' : $this->category->value;
    }

    public function label(): string
    {
        return $this->category === null ? (string) __('shop.all') : $this->category->label();
    }
}
