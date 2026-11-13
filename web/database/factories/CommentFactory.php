<?php

namespace Database\Factories;

use App\Enums\CommentStatus;
use App\Models\BuildUpdate;
use App\Models\Comment;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Comment>
 */
class CommentFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'build_update_id' => BuildUpdate::factory()->post(),
            'user_id' => User::factory(),
            'parent_id' => null,
            'body' => 'Sauber gemacht, welche Federn sind das?',
            'status' => CommentStatus::Visible,
        ];
    }

    public function removed(): static
    {
        return $this->state(fn (): array => ['status' => CommentStatus::Removed]);
    }
}
