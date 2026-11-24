<?php

namespace Database\Factories;

use App\Models\CarOfTheDayCandidate;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CarOfTheDayCandidate>
 */
class CarOfTheDayCandidateFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'day' => now(config()->string('speedclub.car_of_the_day.timezone'))->addDay()->toDateString(),
            'vehicle_id' => Vehicle::factory()->published(),
            'position' => 1,
        ];
    }
}
