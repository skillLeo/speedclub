<?php

namespace Database\Factories;

use App\Models\BuildUpdate;
use App\Models\Mention;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Mention>
 */
class MentionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'mentionable_type' => 'build_update',
            'mentionable_id' => BuildUpdate::factory()->post(),
            'mentioned_user_id' => User::factory(),
            'author_id' => User::factory(),
            'created_at' => now(),
        ];
    }
}
