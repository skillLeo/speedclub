<?php

namespace Database\Factories;

use App\Models\ModCategory;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ModCategory>
 */
class ModCategoryFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'key' => fake()->unique()->lexify('category_????????'),
            'name' => ['de' => 'Fahrwerk', 'en' => 'Suspension'],
            'icon' => 'coilover',
        ];
    }
}
