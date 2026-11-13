<?php

namespace Database\Factories;

use App\Enums\MaintenanceType;
use App\Models\MaintenanceLog;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<MaintenanceLog>
 */
class MaintenanceLogFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'vehicle_id' => Vehicle::factory(),
            'item_id' => null,
            'type' => MaintenanceType::OilChange,
            'title' => null,
            'done_at' => now()->subMonths(6)->toDateString(),
            'mileage_km' => 40000,
            'workshop' => 'Werkstatt am Ring',
            'cost_cents' => 18900,
            'currency' => 'EUR',
            'notes' => 'Öl 5W-30, Filter neu.',
            'version' => 1,
        ];
    }
}
