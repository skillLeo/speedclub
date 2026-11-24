<?php

namespace Database\Factories;

use App\Enums\Bundesland;
use App\Models\DeCity;
use App\Support\Slug;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DeCity>
 */
class DeCityFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = fake()->unique()->city();

        return [
            'id' => fake()->unique()->numberBetween(100_000_000, 999_999_999),
            'name' => $name,
            'ascii_name' => $name,
            'slug' => Slug::make($name),
            'bundesland' => fake()->randomElement(Bundesland::cases()),
            'population' => fake()->numberBetween(1_000, 500_000),
        ];
    }

    public function named(string $name, Bundesland $bundesland = Bundesland::NW, int $population = 100_000): static
    {
        return $this->state(fn (array $attributes) => [
            'name' => $name,
            'ascii_name' => $name,
            'slug' => Slug::make($name),
            'bundesland' => $bundesland,
            'population' => $population,
        ]);
    }
}
