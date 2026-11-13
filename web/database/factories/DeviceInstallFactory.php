<?php

namespace Database\Factories;

use App\Enums\DevicePlatform;
use App\Models\DeviceInstall;
use App\Models\User;
use App\Services\Auth\DeviceInstalls;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DeviceInstall>
 */
class DeviceInstallFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'install_id_hash' => DeviceInstalls::key((string) fake()->uuid(), fake()->unique()->uuid()),
            'platform' => DevicePlatform::Android,
            'model' => 'Pixel 9',
            'os_version' => '16',
            'app_version' => '2.0.0',
            'approx_city' => null,
            'first_seen_at' => now()->subDays(3),
            'last_seen_at' => now(),
        ];
    }
}
