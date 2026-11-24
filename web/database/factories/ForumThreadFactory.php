<?php

namespace Database\Factories;

use App\Enums\ForumPostStatus;
use App\Enums\ForumThreadStatus;
use App\Models\ForumCategory;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\User;
use App\Services\Forum\ForumSearchKeys;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * A published thread with its opening post (created after the thread, ForumThread::openingPost).
 *
 * @extends Factory<ForumThread>
 */
class ForumThreadFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $title = 'Gewindefahrwerk für den Alltag – welche Dämpferhärte?';

        return [
            'category_id' => ForumCategory::factory(),
            'user_id' => User::factory(),
            'title' => $title,
            'slug' => Str::slug($title),
            'status' => ForumThreadStatus::Published,
            'tags' => ['fahrwerk'],
            'replies_count' => 0,
            'last_activity_at' => now(),
            'published_at' => now(),
            'title_keys' => '',
            'is_sample' => false,
        ];
    }

    public function configure(): static
    {
        return $this->afterCreating(function (ForumThread $thread): void {
            if ($thread->openingPost()->exists()) {
                return;
            }

            $status = match ($thread->status) {
                ForumThreadStatus::Pending => ForumPostStatus::Pending,
                ForumThreadStatus::Rejected => ForumPostStatus::Rejected,
                ForumThreadStatus::Removed => ForumPostStatus::Removed,
                default => ForumPostStatus::Published,
            };

            ForumPost::factory()->create([
                'thread_id' => $thread->id,
                'user_id' => $thread->user_id ?? User::factory(),
                'is_opening' => true,
                'status' => $status,
                'body' => 'Ich fahre den Wagen täglich und will trotzdem straffer liegen. Welche Erfahrungen habt ihr mit **Zugstufe** und Federrate?',
                'is_sample' => $thread->is_sample,
            ]);

            // As CreateForumThread: the author follows their own thread.
            if ($thread->user_id !== null) {
                DB::table('forum_subscriptions')->insertOrIgnore(['thread_id' => $thread->id, 'user_id' => $thread->user_id, 'created_at' => now()]);
            }

            app(ForumSearchKeys::class)->refresh($thread);
        });
    }

    public function pending(): static
    {
        return $this->state(fn (): array => ['status' => ForumThreadStatus::Pending, 'published_at' => null]);
    }

    public function locked(): static
    {
        return $this->state(fn (): array => ['is_locked' => true, 'locked_at' => now()]);
    }

    public function pinned(): static
    {
        return $this->state(fn (): array => ['is_pinned' => true, 'pinned_at' => now()]);
    }
}
