<?php

namespace Database\Factories;

use App\Models\IdempotencyKey;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<IdempotencyKey>
 */
class IdempotencyKeyFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'key' => fake()->unique()->uuid(),
            'user_id' => User::factory(),
            'route' => 'POST api/v1/vehicles',
            'response_status' => 201,
            'response_body' => '{"data":{}}',
            'expires_at' => now()->addDay(),
        ];
    }
}
