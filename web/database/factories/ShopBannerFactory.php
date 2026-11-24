<?php

namespace Database\Factories;

use App\Enums\ShopBannerLink;
use App\Enums\ShopCategory;
use App\Models\ShopBanner;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * A banner row whose files are not written (paths only), linking the sticker category.
 *
 * @extends Factory<ShopBanner>
 */
class ShopBannerFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $hash = hash('sha256', Str::random(16));

        return [
            'title' => 'Dein Build. Dein Sticker.',
            'subtitle' => null,
            'link_kind' => ShopBannerLink::Category,
            'shop_product_id' => null,
            'category' => ShopCategory::Sticker,
            'alt' => null,
            'width' => 1920,
            'height' => 1080,
            'original_width' => 1920,
            'original_height' => 1080,
            'focal_x' => 0.5,
            'focal_y' => 0.5,
            'blurhash' => 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
            'thumbhash' => null,
            'original_path' => "shop/originals/$hash.jpg",
            'variants' => [320 => "shop/images/$hash-320.webp", 1080 => "shop/images/$hash-1080.webp", 1600 => "shop/images/$hash-1600.webp"],
            'sha256' => $hash,
            'bytes' => 223456,
            'active' => false,
            'is_sample' => false,
        ];
    }

    public function active(): static
    {
        return $this->state(['active' => true]);
    }
}
