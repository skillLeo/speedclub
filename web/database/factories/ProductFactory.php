<?php

namespace Database\Factories;

use App\Enums\ProductStatus;
use App\Models\Brand;
use App\Models\ModCategory;
use App\Models\Product;
use App\Support\Slug;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * An active product of a test brand, without invented attributes.
 *
 * @extends Factory<Product>
 */
class ProductFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = 'Testteil '.fake()->unique()->lexify('????????');

        return [
            'brand_id' => Brand::factory(),
            'category_id' => ModCategory::factory(),
            'name' => $name,
            'line' => null,
            'slug' => Slug::make($name),
            'attributes' => null,
            'url' => null,
            'affiliate_url' => null,
            'status' => ProductStatus::Active,
        ];
    }

    public function archived(): static
    {
        return $this->state(['status' => ProductStatus::Archived]);
    }
}
