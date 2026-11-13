<?php

namespace Database\Factories;

use App\Enums\MaintenanceType;
use App\Models\MaintenanceItem;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<MaintenanceItem>
 */
class MaintenanceItemFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'vehicle_id' => Vehicle::factory(),
            'type' => MaintenanceType::OilChange,
            'slot' => MaintenanceType::OilChange->value,
            'title' => null,
            'interval_months' => 12,
            'interval_km' => 15000,
            'last_done_at' => now()->subMonths(6)->toDateString(),
            'last_done_km' => 40000,
            'next_due_at' => now()->addMonths(6)->toDateString(),
            'next_due_km' => 55000,
            'due_pinned' => false,
            'lead_days' => [14],
            'enabled' => true,
            'notes' => null,
            'version' => 1,
        ];
    }

    public function type(MaintenanceType $type): static
    {
        return $this->state(fn (): array => ['type' => $type, 'slot' => $type->isSingleton() ? $type->value : null, 'title' => $type === MaintenanceType::Custom ? 'Zahnriemen' : null]);
    }
}
