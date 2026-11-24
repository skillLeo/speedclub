<?php

namespace Database\Factories;

use App\Enums\ShopCategory;
use App\Enums\ShopPurchaseMode;
use App\Enums\ShopVariantKind;
use App\Models\ShopProduct;
use App\Models\ShopProductImage;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<ShopProduct>
 */
class ShopProductFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $title = 'Testprodukt '.Str::lower(Str::random(6));

        return [
            'slug' => Str::slug($title),
            'title' => $title,
            'description' => null,
            'category' => ShopCategory::Sticker,
            'price_cents' => 1490,
            'currency' => 'EUR',
            'variant_kind' => ShopVariantKind::Size,
            'variants' => [],
            'purchase_mode' => ShopPurchaseMode::Shopify,
            'shopify_url' => null,
            'sort' => 1,
            'visible' => false,
            'is_sample' => false,
        ];
    }

    /** Shown in the shop: visible with one photo row (the files are not written; use ShopImages for real ones). */
    public function listed(): static
    {
        return $this->state(['visible' => true])->has(ShopProductImage::factory(), 'images');
    }

    public function sample(): static
    {
        return $this->state(['is_sample' => true]);
    }

    public function designer(): static
    {
        return $this->state(['purchase_mode' => ShopPurchaseMode::StickerDesigner]);
    }
}
