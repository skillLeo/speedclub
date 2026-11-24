<?php

namespace App\Services\Shop;

use App\Enums\ShopCategory;
use App\Enums\ShopCategoryStatus;

/**
 * R4-3.2: which shop categories are open (speedclub.shop.categories). A category the config does not name, or names with an unknown
 * status, counts as coming_soon, so a typo never opens a category by accident.
 */
final class ShopCategories
{
    public function status(?ShopCategory $category): ShopCategoryStatus
    {
        if ($category === null) {
            return ShopCategoryStatus::Available;
        }

        $value = config('speedclub.shop.categories.'.$category->value);

        return is_string($value) ? (ShopCategoryStatus::tryFrom($value) ?? ShopCategoryStatus::ComingSoon) : ShopCategoryStatus::ComingSoon;
    }

    public function isAvailable(?ShopCategory $category): bool
    {
        return $this->status($category) === ShopCategoryStatus::Available;
    }

    /**
     * @return list<string> the values of the open categories
     */
    public function availableValues(): array
    {
        return array_values(array_map(
            fn (ShopCategory $category): string => $category->value,
            array_filter(ShopCategory::cases(), fn (ShopCategory $category): bool => $this->isAvailable($category)),
        ));
    }
}
