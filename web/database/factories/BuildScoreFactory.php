<?php

namespace Database\Factories;

use App\Models\BuildScore;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<BuildScore>
 */
class BuildScoreFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'vehicle_id' => Vehicle::factory(),
            'total' => 420,
            'completeness' => 200,
            'documentation' => 150,
            'community' => 30,
            'journey' => 40,
            'stage' => 3,
            'breakdown' => [],
            'previous_total' => null,
            'formula_version' => '1',
            'changed_at' => now(),
            'computed_at' => now(),
        ];
    }

    /**
     * A total with the parts and stage that fit it (parts are a rough split, enough for lists and ranks).
     */
    public function total(int $total): static
    {
        return $this->state(fn (): array => [
            'total' => $total,
            'completeness' => intdiv($total * 3, 10),
            'documentation' => intdiv($total * 3, 10),
            'community' => intdiv($total * 25, 100),
            'journey' => $total - intdiv($total * 3, 10) * 2 - intdiv($total * 25, 100),
            'stage' => min(5, intdiv($total, 200) + 1),
        ]);
    }
}
