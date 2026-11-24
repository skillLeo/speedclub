<?php

namespace App\Actions\Admin\Forum;

use App\Enums\ErrorCode;
use App\Enums\ForumAuditEvent;
use App\Enums\ForumPostStatus;
use App\Enums\ForumThreadStatus;
use App\Exceptions\ApiException;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Forum\ForumCounters;
use App\Services\Forum\ForumModeration;
use App\Services\Forum\ForumNotifications;
use App\Services\Forum\ForumSearchKeys;
use Illuminate\Support\Facades\DB;

/**
 * ADM Forum-Moderation, pre-moderation (10 §7.3, m5.8-contract §6): staff approve a pending post (an opening post publishes its thread)
 * or reject it with a reason its author reads on FOR-05. Nothing was public yet, so this is no DSA decision about published content;
 * published content is removed through HideForumPost. Optimistic locking on `version` (updated_at, ADR-439): a post that changed since
 * answers 409 edit_conflict; one that is no longer pending 409 conflict. Audited with the reason.
 */
class ReviewForumPost
{
    public function __construct(
        private readonly ForumCounters $counters,
        private readonly ForumNotifications $notifications,
        private readonly ForumSearchKeys $keys,
        private readonly ForumModeration $moderation,
    ) {}

    /**
     * The post's and its thread's last change (review nit: a title edit of a pending thread changes the version too).
     */
    public static function version(ForumPost $post): ?string
    {
        $thread = ForumThread::withTrashed()->find($post->thread_id);

        return $post->updated_at?->toIso8601String().'|'.$thread?->updated_at?->toIso8601String();
    }

    public function approve(Staff $staff, ForumPost $post, ?string $reason, string $seen): ForumPost
    {
        return $this->decide($staff, $post, true, $reason, $seen);
    }

    public function reject(Staff $staff, ForumPost $post, string $reason, string $seen): ForumPost
    {
        return $this->decide($staff, $post, false, $reason, $seen);
    }

    private function decide(Staff $staff, ForumPost $post, bool $approve, ?string $reason, string $seen): ForumPost
    {
        return DB::transaction(function () use ($staff, $post, $approve, $reason, $seen): ForumPost {
            /** @var ForumPost $locked */
            $locked = ForumPost::query()->whereKey($post->id)->lockForUpdate()->firstOrFail();

            if ($seen !== self::version($locked)) {
                throw new ApiException(ErrorCode::EditConflict);
            }

            if ($locked->status !== ForumPostStatus::Pending) {
                throw new ApiException(ErrorCode::Conflict);
            }

            $now = now();
            // SEC-P5-09: a post that was public before came back with a change of an author still in pre-moderation. Approved, it returns
            // in its place (published_at kept) and notifies only new mentions, not a new reply.
            $again = $locked->published_at !== null;
            $review = ['reviewed_by' => $staff->id, 'reviewed_at' => $now, 'review_reason' => $approve ? null : $reason];
            $locked->forceFill([
                'status' => $approve ? ForumPostStatus::Published : ForumPostStatus::Rejected,
                'published_at' => $approve ? ($locked->published_at ?? $now) : null,
                ...$review,
            ])->save();

            /** @var ForumThread $thread */
            $thread = ForumThread::withTrashed()->whereKey($locked->thread_id)->lockForUpdate()->firstOrFail();

            if ($locked->is_opening && $thread->status === ForumThreadStatus::Pending) {
                $thread->forceFill([
                    'status' => $approve ? ForumThreadStatus::Published : ForumThreadStatus::Rejected,
                    'published_at' => $approve ? ($thread->published_at ?? $now) : $thread->published_at,
                    'last_activity_at' => $approve && $thread->published_at === null ? $now : $thread->last_activity_at,
                    ...$review,
                ])->save();
            } elseif ($locked->is_opening && ! $approve && $thread->status === ForumThreadStatus::Published) {
                // SEC-P5-09: the change of a published thread is turned down: the thread leaves the forum with its opening post, and its
                // author can fix it and resubmit (PATCH forum/threads/{thread}), like a thread rejected on its first review.
                $thread->forceFill(['status' => ForumThreadStatus::Rejected, 'is_pinned' => false, 'pinned_at' => null, ...$review])->save();
            }

            if ($locked->is_opening) {
                $this->keys->refresh($thread);
            }

            $this->counters->thread($thread);
            $this->counters->category($thread->category_id);

            Audit::record(
                ($approve ? ForumAuditEvent::PostApproved : ForumAuditEvent::PostRejected)->value,
                $locked,
                ['status' => ForumPostStatus::Pending->value],
                ['status' => $locked->status->value, 'thread_id' => $thread->id, 'is_opening' => $locked->is_opening],
                $reason,
                $staff,
            );

            if ($approve) {
                $locked->setRelation('thread', $thread);
                $again ? $this->notifications->edited($locked) : $this->notifications->published($locked);

                // A thread rejected once and resubmitted gets its photos back (nothing happens to photos that kept their files).
                if ($locked->is_opening) {
                    DB::afterCommit($this->moderation->republishPhotos($locked));
                }
            } elseif ($locked->is_opening) {
                // MF-2: the photos of a thread that never went public stop being hosted; the originals stay (a later edit re-submits).
                DB::afterCommit($this->moderation->withdrawPhotos($locked));
            }

            return $locked;
        });
    }
}
