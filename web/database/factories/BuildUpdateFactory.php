<?php

namespace Database\Factories;

use App\Enums\BuildUpdateType;
use App\Models\BuildUpdate;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<BuildUpdate>
 */
class BuildUpdateFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'vehicle_id' => Vehicle::factory(),
            'type' => BuildUpdateType::ModAdded,
            'payload' => ['before' => 'Serie', 'after' => 'KW V3'],
        ];
    }
}
