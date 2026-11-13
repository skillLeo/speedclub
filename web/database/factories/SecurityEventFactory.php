<?php

namespace Database\Factories;

use App\Enums\DevicePlatform;
use App\Enums\MemberSecurityEvent;
use App\Models\SecurityEvent;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<SecurityEvent>
 */
class SecurityEventFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'type' => MemberSecurityEvent::SignedIn,
            'device_name' => 'Pixel 9',
            'platform' => DevicePlatform::Android,
            'approx_city' => null,
            'meta' => ['method' => 'email_code'],
            'created_at' => now(),
        ];
    }
}
