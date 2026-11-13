<?php

namespace Database\Factories;

use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleFollow;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<VehicleFollow>
 */
class VehicleFollowFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'vehicle_id' => Vehicle::factory()->published(),
            'created_at' => now(),
        ];
    }
}
