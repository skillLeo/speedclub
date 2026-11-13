<?php

namespace Database\Factories;

use App\Enums\ReactionType;
use App\Models\BuildUpdate;
use App\Models\Reaction;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Reaction>
 */
class ReactionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'reactable_type' => 'build_update',
            'reactable_id' => BuildUpdate::factory()->post(),
            'type' => ReactionType::Clean,
        ];
    }
}
