<?php

namespace App\Actions\Forum;

use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Services\Forum\ForumCounters;
use App\Services\Social\Mentions;
use Illuminate\Support\Facades\DB;

/**
 * The author deletes a reply (soft delete). Answers to it stay; the list shows a top-level reply that is gone as a tombstone while it has
 * visible answers. A reply marked as the solution stops being the solution.
 */
class DeleteForumPost
{
    public function __construct(private readonly ForumCounters $counters) {}

    public function handle(ForumPost $post): void
    {
        DB::transaction(function () use ($post): void {
            /** @var ForumThread $thread */
            $thread = ForumThread::withTrashed()->whereKey($post->thread_id)->lockForUpdate()->firstOrFail();
            Mentions::forget($post);
            $post->delete();

            if ($thread->solved_post_id === $post->id) {
                $thread->forceFill(['solved_post_id' => null, 'solved_at' => null])->save();
            }

            $this->counters->thread($thread);
        });
    }
}
