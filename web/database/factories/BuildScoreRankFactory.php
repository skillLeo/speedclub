<?php

namespace Database\Factories;

use App\Enums\BuildScoreRankScope;
use App\Models\BuildScoreRank;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<BuildScoreRank>
 */
class BuildScoreRankFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'vehicle_id' => Vehicle::factory(),
            'scope' => BuildScoreRankScope::Bundesland,
            'scope_key' => 'NW',
            'rank' => 2,
            'group_size' => 14,
            'computed_at' => now(),
        ];
    }
}
