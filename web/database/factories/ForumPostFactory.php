<?php

namespace Database\Factories;

use App\Enums\ForumPostStatus;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A published reply. Counters on the thread are not updated: tests that read them set them or go through the API.
 *
 * @extends Factory<ForumPost>
 */
class ForumPostFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'thread_id' => ForumThread::factory(),
            'user_id' => User::factory(),
            'parent_id' => null,
            'is_opening' => false,
            'body' => 'Ich hatte das gleiche Problem. Lass die Spur nach dem Einbau vermessen, dann passt es.',
            'status' => ForumPostStatus::Published,
            'helpful_count' => 0,
            'published_at' => now(),
            'is_sample' => false,
        ];
    }

    /**
     * Keeps the stored tree in step with the text, as every writer does (ForumPost::writeBody).
     */
    public function configure(): static
    {
        return $this->afterMaking(fn (ForumPost $post) => $post->writeBody($post->body));
    }

    public function pending(): static
    {
        return $this->state(fn (): array => ['status' => ForumPostStatus::Pending, 'published_at' => null]);
    }
}
