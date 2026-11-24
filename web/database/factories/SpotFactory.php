<?php

namespace Database\Factories;

use App\Enums\SpotSource;
use App\Models\Spot;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A counted day spot without a city. Tests that care about the rules go through POST spots (RecordSpot).
 *
 * @extends Factory<Spot>
 */
class SpotFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'vehicle_id' => Vehicle::factory()->published(),
            'spotter_id' => User::factory(),
            'city_id' => null,
            'bundesland' => null,
            'is_first_three' => false,
            'counted' => true,
            'is_night' => false,
            'source' => SpotSource::Scanner,
            'created_at' => now(),
        ];
    }
}
