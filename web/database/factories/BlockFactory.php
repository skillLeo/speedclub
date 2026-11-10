<?php

namespace Database\Factories;

use App\Models\Block;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Block>
 */
class BlockFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'blocker_id' => User::factory(),
            'blocked_id' => User::factory(),
            // The name as BlockMember stores it: the blocked member's username at the time of the block.
            'blocked_username' => fn (array $attributes) => User::query()->whereKey($attributes['blocked_id'])->value('username'),
        ];
    }
}
