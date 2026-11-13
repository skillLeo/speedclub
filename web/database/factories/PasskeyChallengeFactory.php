<?php

namespace Database\Factories;

use App\Enums\PasskeyCeremony;
use App\Models\PasskeyChallenge;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<PasskeyChallenge>
 */
class PasskeyChallengeFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'ceremony' => PasskeyCeremony::Authentication,
            'options' => [],
            'expires_at' => now()->addMinutes(5),
        ];
    }
}
