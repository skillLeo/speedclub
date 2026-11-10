<?php

namespace Database\Factories;

use App\Models\KnownDevice;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<KnownDevice>
 */
class KnownDeviceFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'fingerprint' => hash('sha256', fake()->unique()->uuid()),
            'last_seen_at' => now(),
        ];
    }
}
