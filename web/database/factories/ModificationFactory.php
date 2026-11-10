<?php

namespace Database\Factories;

use App\Enums\ModStatus;
use App\Models\Brand;
use App\Models\ModCategory;
use App\Models\Modification;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Modification>
 */
class ModificationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'vehicle_id' => Vehicle::factory(),
            'category_id' => ModCategory::factory(),
            'title' => 'KW V3',
            'brand_id' => Brand::factory(),
            'part_name' => 'V3',
            'status' => ModStatus::Installed,
            'installed_on' => now()->startOfMonth(),
            'fields' => ['type' => 'Gewindefahrwerk', 'lowering_front' => 35],
        ];
    }
}
