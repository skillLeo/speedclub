<?php

namespace Database\Factories;

use App\Models\Make;
use App\Support\Slug;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Make>
 */
class MakeFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = fake()->unique()->lexify('Marke ????????');

        return [
            'name' => $name,
            'slug' => Slug::make($name),
            'country' => 'DE',
        ];
    }
}
