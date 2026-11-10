<?php

namespace Database\Factories;

use App\Enums\DevicePlatform;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<PersonalAccessToken>
 */
class PersonalAccessTokenFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'tokenable_type' => (new User)->getMorphClass(),
            'tokenable_id' => User::factory(),
            'name' => 'Pixel 9',
            'token' => hash('sha256', Str::random(40)),
            'abilities' => ['member'],
            'device_name' => 'Pixel 9',
            'platform' => DevicePlatform::Android,
            'app_version' => '1.0.0',
            'expires_at' => now()->addDays(90),
        ];
    }
}
