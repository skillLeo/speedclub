<?php

namespace Database\Factories;

use App\Enums\CarOfTheDaySource;
use App\Models\CarOfTheDay;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CarOfTheDay>
 */
class CarOfTheDayFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'day' => now(config()->string('speedclub.car_of_the_day.timezone'))->toDateString(),
            'vehicle_id' => Vehicle::factory()->published(),
            'story_line' => null,
            'bundesland' => null,
            'source' => CarOfTheDaySource::Auto,
            'is_sample' => false,
            'skipped' => false,
            'skipped_reason' => null,
            'picked_at' => now(),
            'published_at' => now(),
        ];
    }
}
