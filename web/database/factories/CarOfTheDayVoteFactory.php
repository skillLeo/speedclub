<?php

namespace Database\Factories;

use App\Models\CarOfTheDayVote;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CarOfTheDayVote>
 */
class CarOfTheDayVoteFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'day' => now(config()->string('speedclub.car_of_the_day.timezone'))->addDay()->toDateString(),
            'user_id' => User::factory(),
            'vehicle_id' => Vehicle::factory()->published(),
        ];
    }
}
