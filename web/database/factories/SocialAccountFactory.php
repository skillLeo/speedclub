<?php

namespace Database\Factories;

use App\Enums\SocialProvider;
use App\Models\SocialAccount;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<SocialAccount>
 */
class SocialAccountFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'provider' => SocialProvider::Google,
            'provider_sub' => (string) $this->faker->unique()->numerify('1############'),
            'email' => $this->faker->safeEmail(),
            'email_verified' => true,
            'is_private_relay' => false,
        ];
    }

    public function apple(): static
    {
        return $this->state(fn (): array => [
            'provider' => SocialProvider::Apple,
            'provider_sub' => '001234.'.$this->faker->unique()->sha1().'.1234',
        ]);
    }
}
