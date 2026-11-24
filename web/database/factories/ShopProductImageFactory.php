<?php

namespace Database\Factories;

use App\Models\ShopProduct;
use App\Models\ShopProductImage;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * A photo row whose files are not written (paths only); tests of the pipeline upload through ShopImages.
 *
 * @extends Factory<ShopProductImage>
 */
class ShopProductImageFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $hash = hash('sha256', Str::random(16));

        return [
            'shop_product_id' => ShopProduct::factory(),
            'sort' => 1,
            'alt' => null,
            'width' => 1600,
            'height' => 2000,
            'original_width' => 2000,
            'original_height' => 2000,
            'focal_x' => 0.5,
            'focal_y' => 0.5,
            'blurhash' => 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
            'thumbhash' => null,
            'original_path' => "shop/originals/$hash.jpg",
            'variants' => [320 => "shop/images/$hash-320.webp", 640 => "shop/images/$hash-640.webp", 1080 => "shop/images/$hash-1080.webp", 1600 => "shop/images/$hash-1600.webp"],
            'sha256' => $hash,
            'bytes' => 123456,
        ];
    }
}
