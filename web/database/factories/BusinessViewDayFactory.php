<?php

namespace Database\Factories;

use App\Models\Business;
use App\Models\BusinessViewDay;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<BusinessViewDay>
 */
class BusinessViewDayFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'business_id' => Business::factory(),
            'day' => now()->toDateString(),
            'views' => 1,
        ];
    }
}
