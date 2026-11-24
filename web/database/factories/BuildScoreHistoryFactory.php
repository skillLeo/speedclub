<?php

namespace Database\Factories;

use App\Models\BuildScoreHistory;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<BuildScoreHistory>
 */
class BuildScoreHistoryFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'vehicle_id' => Vehicle::factory(),
            'day' => now()->toDateString(),
            'total' => 420,
        ];
    }
}
