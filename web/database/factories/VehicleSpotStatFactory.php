<?php

namespace Database\Factories;

use App\Models\Vehicle;
use App\Models\VehicleSpotStat;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<VehicleSpotStat>
 */
class VehicleSpotStatFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'vehicle_id' => Vehicle::factory()->published(),
            'total' => 0,
            'unique_spotters' => 0,
            'cities_count' => 0,
            'last_spot_at' => null,
            'street_famous_tier' => null,
        ];
    }
}
