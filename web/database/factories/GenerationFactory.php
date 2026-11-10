<?php

namespace Database\Factories;

use App\Models\Generation;
use App\Models\VehicleModel;
use App\Support\Slug;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Generation>
 */
class GenerationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = fake()->unique()->bothify('?##');
        $from = fake()->numberBetween(1990, 2020);

        return [
            'model_id' => VehicleModel::factory(),
            'name' => $name,
            'year_from' => $from,
            'year_to' => $from + 6,
            'slug' => Slug::make($name),
        ];
    }
}
