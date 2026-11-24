<?php

namespace App\Jobs\Forum;

use App\Models\ForumPost;
use App\Services\Forum\ForumNotifications;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * M5.8 (m5.8-contract §5): tells the thread's author and subscribers about a published reply (and the author of the post it answers), in
 * slices of subscribers by user id within 40 s; a slice that runs out of time queues the rest. Notifier groups by thread and day, so a
 * retried slice tells nobody twice. Carries ids only.
 */
class NotifyForumPost implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 50;

    /**
     * $afterUserId: the subscriber to continue after (a member id), '' for the first slice. Ids only (GarageSecurityAuditTest).
     */
    public function __construct(public readonly string $postId, public readonly string $afterUserId = '') {}

    public function handle(ForumNotifications $notifications): void
    {
        $post = ForumPost::query()->with(['thread', 'user', 'parent'])->find($this->postId);

        if (! $post instanceof ForumPost || ! $post->isPublished()) {
            return;
        }

        $next = $notifications->replyFanout($post, $this->afterUserId === '' ? null : $this->afterUserId, microtime(true) + 40);

        if ($next !== null) {
            dispatch(new self($this->postId, $next));
        }
    }
}
