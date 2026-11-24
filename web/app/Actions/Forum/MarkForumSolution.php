<?php

namespace App\Actions\Forum;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Services\Forum\ForumNotifications;
use App\Services\Progress\XpHooks;
use Illuminate\Support\Facades\DB;

/**
 * "Gelöst" (10 §7.2): one published reply of the thread is its solution; marking another replaces it, null clears it. The reply's author
 * hears about it (forum_solved), not when it is the thread author's own reply, and earns the solution XP by its fixed rules
 * (XpHooks::forumSolution, SEC-P5-14). Staff use the same action from the admin (audited there).
 */
class MarkForumSolution
{
    public function __construct(
        private readonly ForumNotifications $notifications,
        private readonly XpHooks $xp,
    ) {}

    public function handle(ForumThread $thread, ?ForumPost $post): ForumThread
    {
        if ($post !== null && ($post->thread_id !== $thread->id || $post->is_opening || ! $post->isPublished())) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: ['post_id' => [(string) __('forum.solution.invalid')]]);
        }

        return DB::transaction(function () use ($thread, $post): ForumThread {
            /** @var ForumThread $locked */
            $locked = ForumThread::query()->whereKey($thread->id)->lockForUpdate()->firstOrFail();
            $changed = $locked->solved_post_id !== $post?->id;

            $locked->forceFill(['solved_post_id' => $post?->id, 'solved_at' => $post === null ? null : ($changed ? now() : $locked->solved_at)])->save();

            if ($post !== null && $changed) {
                $this->notifications->solved($locked, $post);
                $this->xp->forumSolution($locked, $post);
            }

            $thread->setRawAttributes($locked->getAttributes(), true);

            return $thread;
        });
    }
}
