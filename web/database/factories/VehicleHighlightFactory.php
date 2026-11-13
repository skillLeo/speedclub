<?php

namespace Database\Factories;

use App\Enums\HighlightItemType;
use App\Models\BuildUpdate;
use App\Models\Vehicle;
use App\Models\VehicleHighlight;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<VehicleHighlight>
 */
class VehicleHighlightFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'vehicle_id' => Vehicle::factory()->published(),
            'item_type' => HighlightItemType::BuildUpdate,
            'item_id' => BuildUpdate::factory()->post(),
            'position' => 0,
            'created_at' => now(),
        ];
    }
}
