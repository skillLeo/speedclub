<?php

namespace Database\Factories;

use App\Models\Brand;
use App\Support\Slug;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Brand>
 */
class BrandFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = fake()->unique()->lexify('Hersteller ????????');

        return [
            'name' => $name,
            'slug' => Slug::make($name),
        ];
    }
}
