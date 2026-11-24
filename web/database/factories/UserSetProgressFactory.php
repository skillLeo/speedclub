<?php

namespace Database\Factories;

use App\Models\DexSet;
use App\Models\User;
use App\Models\UserSetProgress;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<UserSetProgress>
 */
class UserSetProgressFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'set_key' => fn () => DexSet::factory()->create()->key,
            'period' => '',
            'progress' => 0,
            'target' => 10,
            'completed_at' => null,
        ];
    }
}
