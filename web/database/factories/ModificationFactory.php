<?php

namespace Database\Factories;

use App\Enums\ModPriority;
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

    /**
     * M5.3: a plan with a target month, priority and private budget, at the end of the vehicle's plans.
     */
    public function planned(): static
    {
        return $this->state(fn (array $attributes): array => [
            'status' => ModStatus::Planned,
            'installed_on' => null,
            'target_month' => now()->addMonths(4)->startOfMonth(),
            'priority' => ModPriority::Normal,
            'budget_cents' => 120000,
            'plan_sort' => 1,
        ]);
    }
}
