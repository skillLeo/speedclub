<?php

namespace Database\Factories;

use App\Models\SpotAlert;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<SpotAlert>
 */
class SpotAlertFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'vehicle_id' => Vehicle::factory()->published(),
            'window_start' => now(),
            'count' => 1,
            'city_ids' => [],
            'sent_at' => null,
        ];
    }
}
