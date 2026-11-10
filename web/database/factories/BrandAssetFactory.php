<?php

namespace Database\Factories;

use App\Enums\BrandAssetKind;
use App\Models\BrandAsset;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<BrandAsset>
 */
class BrandAssetFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $hash = hash('sha256', fake()->uuid());

        return [
            'kind' => BrandAssetKind::Hero,
            'original_path' => "brand/assets/$hash.jpg",
            'variants' => ['640' => "brand/assets/$hash-640.webp", '1080' => "brand/assets/$hash-1080.webp"],
            'width' => 1080,
            'height' => 1920,
            'blurhash' => 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
            'bytes' => 250000,
            'sha256' => $hash,
        ];
    }
}
