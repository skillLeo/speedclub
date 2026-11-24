<?php

namespace Database\Factories;

use App\Models\InviteCode;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<InviteCode>
 */
class InviteCodeFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => fake()->unique()->regexify('[0-9A-HJKMNP-TV-Z]{8}'),
            'inviter_id' => User::factory(),
            'accepted_by' => null,
            'accepted_at' => null,
            'created_at' => now(),
        ];
    }
}
