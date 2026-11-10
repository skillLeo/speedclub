<?php

namespace Database\Factories;

use App\Enums\DevicePlatform;
use App\Models\PushToken;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<PushToken>
 */
class PushTokenFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'token' => 'ExponentPushToken['.fake()->unique()->regexify('[A-Za-z0-9]{22}').']',
            'platform' => fake()->randomElement([DevicePlatform::Ios, DevicePlatform::Android]),
            'device_id' => fake()->uuid(),
            'last_used_at' => now(),
        ];
    }
}
