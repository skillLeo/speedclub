<?php

namespace Database\Factories;

use App\Models\Make;
use App\Models\VehicleModel;
use App\Support\Slug;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<VehicleModel>
 */
class VehicleModelFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = fake()->unique()->bothify('Modell ??##');

        return [
            'make_id' => Make::factory(),
            'name' => $name,
            'slug' => Slug::make($name),
        ];
    }
}
