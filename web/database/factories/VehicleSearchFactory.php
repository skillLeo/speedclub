<?php

namespace Database\Factories;

use App\Models\Vehicle;
use App\Models\VehicleSearch;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<VehicleSearch>
 */
class VehicleSearchFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'vehicle_id' => Vehicle::factory()->published(),
            'owner_id' => fn (array $attributes) => Vehicle::query()->whereKey($attributes['vehicle_id'])->value('owner_id'),
            'make_id' => fn (array $attributes) => Vehicle::query()->whereKey($attributes['vehicle_id'])->value('make_id'),
            'model_id' => fn (array $attributes) => Vehicle::query()->whereKey($attributes['vehicle_id'])->value('model_id'),
            'generation_id' => fn (array $attributes) => Vehicle::query()->whereKey($attributes['vehicle_id'])->value('generation_id'),
            'search_text' => 'bmw m4 g82 kw v3',
            'is_public' => true,
            'published_at' => now(),
            'rank_score' => 1.0,
        ];
    }
}
