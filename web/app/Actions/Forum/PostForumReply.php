<?php

namespace App\Actions\Forum;

use App\Enums\ErrorCode;
use App\Enums\ForumPostStatus;
use App\Enums\KeywordField;
use App\Exceptions\ApiException;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\User;
use App\Services\Forum\ForumCounters;
use App\Services\Forum\ForumNotifications;
use App\Services\Forum\ForumPremoderation;
use App\Services\Rules\ContentScreen;
use Illuminate\Support\Facades\DB;

/**
 * A reply in a thread (FOR-03, m5.8-contract §2): one level of nesting, so an answer to a reply joins its top-level reply. Keyword rules,
 * pre-moderation for new or unverified accounts, the thread's counters under its lock; a published reply notifies the author,
 * subscribers and the member answered (NotifyForumPost), mentions notify at once.
 */
class PostForumReply
{
    public function __construct(
        private readonly ContentScreen $screen,
        private readonly ForumPremoderation $premoderation,
        private readonly ForumCounters $counters,
        private readonly ForumNotifications $notifications,
    ) {}

    public function handle(User $author, ForumThread $thread, string $body, ?ForumPost $parent): ForumPost
    {
        $body = trim(str_replace(["\r\n", "\r"], "\n", $body));
        $flags = $this->screen->screen(['body' => [KeywordField::ForumText, $body]]);
        $pending = $this->premoderation->needsReview($author);
        $top = $parent === null ? null : ($parent->parent_id === null ? $parent : $parent->parent);

        $post = DB::transaction(function () use ($author, $thread, $body, $top, $pending): ForumPost {
            /** @var ForumThread $locked */
            $locked = ForumThread::query()->whereKey($thread->id)->lockForUpdate()->firstOrFail();

            if (! $locked->isPublished() || $locked->is_locked) {
                throw new ApiException(ErrorCode::ForumThreadClosed);
            }

            $now = now();
            $post = new ForumPost;
            $post->forceFill([
                'thread_id' => $locked->id,
                'user_id' => $author->id,
                'parent_id' => $top?->id,
                'is_opening' => false,
                'status' => $pending ? ForumPostStatus::Pending : ForumPostStatus::Published,
                'published_at' => $pending ? null : $now,
                'is_sample' => $author->getAttribute('is_sample') === true,
            ])->writeBody($body)->save();
            $post->setRelation('thread', $locked)->setRelation('user', $author)->setRelation('parent', $top);

            if (! $pending) {
                $this->counters->thread($locked);
                $this->notifications->published($post);
            }

            return $post;
        });

        $this->screen->flagAfterCommit($flags, $post);

        return $post;
    }
}
