<?php

namespace App\Actions\Admin\Forum;

use App\Actions\Forum\MarkForumSolution;
use App\Enums\ErrorCode;
use App\Enums\ForumAuditEvent;
use App\Enums\ForumThreadStatus;
use App\Exceptions\ApiException;
use App\Models\ForumCategory;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Forum\ForumCounters;
use App\Services\Forum\ForumSearchKeys;
use Illuminate\Support\Facades\DB;

/**
 * Staff tools of a thread (10 §7.3, m5.8-contract §6): pin, unpin, lock, unlock, move to another category, merge into another thread
 * (its replies move there, the source stays as a pointer with status merged, its subscribers follow), and correct the solution. Each is
 * audited with before, after and the reason. Hiding content is a DSA decision (HideForumPost).
 */
class ForumThreadTools
{
    public function __construct(
        private readonly ForumCounters $counters,
        private readonly ForumSearchKeys $keys,
        private readonly MarkForumSolution $solution,
    ) {}

    public function pin(Staff $staff, ForumThread $thread, bool $pinned, ?string $reason): ForumThread
    {
        return $this->flip($staff, $thread, 'is_pinned', 'pinned_at', $pinned, $pinned ? ForumAuditEvent::ThreadPinned : ForumAuditEvent::ThreadUnpinned, $reason);
    }

    public function lock(Staff $staff, ForumThread $thread, bool $locked, ?string $reason): ForumThread
    {
        return $this->flip($staff, $thread, 'is_locked', 'locked_at', $locked, $locked ? ForumAuditEvent::ThreadLocked : ForumAuditEvent::ThreadUnlocked, $reason);
    }

    public function move(Staff $staff, ForumThread $thread, ForumCategory $category, string $reason): ForumThread
    {
        return DB::transaction(function () use ($staff, $thread, $category, $reason): ForumThread {
            $locked = $this->lockThread($thread);
            $before = $locked->category_id;
            $locked->forceFill(['category_id' => $category->id])->save();
            $this->keys->refresh($locked->setRelation('category', $category));
            $this->counters->category($before, $category->id);
            Audit::record(ForumAuditEvent::ThreadMoved->value, $locked, ['category_id' => $before], ['category_id' => $category->id], $reason, $staff);

            return $locked;
        });
    }

    public function merge(Staff $staff, ForumThread $source, ForumThread $target, string $reason): ForumThread
    {
        if ($source->id === $target->id || $target->status !== ForumThreadStatus::Published || $target->trashed()) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: ['into_thread_id' => [(string) __('forum.merge_invalid')]]);
        }

        return DB::transaction(function () use ($staff, $source, $target, $reason): ForumThread {
            // Both rows in one statement, in key order: two staff merging A into B and B into A at once queue instead of deadlocking.
            $rows = ForumThread::query()->whereKey([$source->id, $target->id])->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $locked = $rows->get($source->id);
            $into = $rows->get($target->id);

            if (! $locked instanceof ForumThread || ! $into instanceof ForumThread || $locked->status !== ForumThreadStatus::Published || $into->status !== ForumThreadStatus::Published) {
                throw new ApiException(ErrorCode::Conflict);
            }

            $before = [
                'source' => $locked->only(['status', 'merged_into_id', 'category_id', 'replies_count', 'is_pinned', 'is_locked', 'solved_post_id']),
                'target' => $into->only(['replies_count', 'last_post_id']),
            ];

            $moved = ForumPost::query()->where('thread_id', $locked->id)->where('is_opening', false)->pluck('id')->all();
            // The source's opening post becomes a reply in the target, so its question stays readable there.
            ForumPost::withTrashed()->where('thread_id', $locked->id)->update(['thread_id' => $into->id, 'is_opening' => false]);
            DB::table('forum_subscriptions')->where('thread_id', $locked->id)->get()->each(fn (object $row) => DB::table('forum_subscriptions')
                ->insertOrIgnore(['thread_id' => $into->id, 'user_id' => $row->user_id, 'created_at' => $row->created_at]));
            DB::table('forum_subscriptions')->where('thread_id', $locked->id)->delete();

            $locked->forceFill(['status' => ForumThreadStatus::Merged, 'merged_into_id' => $into->id, 'is_pinned' => false, 'solved_post_id' => null, 'solved_at' => null])->save();
            $this->counters->thread($locked);
            $this->counters->thread($into);
            $this->counters->category($locked->category_id, $into->category_id);
            $this->keys->refresh($into);

            Audit::record(ForumAuditEvent::ThreadMerged->value, $locked, $before, [
                'source' => $locked->only(['status', 'merged_into_id', 'category_id', 'replies_count', 'is_pinned', 'is_locked', 'solved_post_id']),
                'target' => $into->only(['replies_count', 'last_post_id']),
                'moved_posts' => [...array_map(strval(...), $moved), 'opening'],
            ], $reason, $staff);

            return $locked;
        });
    }

    public function setSolution(Staff $staff, ForumThread $thread, ?ForumPost $post, string $reason): ForumThread
    {
        $before = $thread->solved_post_id;
        $thread = $this->solution->handle($thread, $post);
        Audit::record(ForumAuditEvent::SolutionSet->value, $thread, ['solved_post_id' => $before], ['solved_post_id' => $thread->solved_post_id], $reason, $staff);

        return $thread;
    }

    private function flip(Staff $staff, ForumThread $thread, string $flag, string $at, bool $value, ForumAuditEvent $event, ?string $reason): ForumThread
    {
        return DB::transaction(function () use ($staff, $thread, $flag, $at, $value, $event, $reason): ForumThread {
            $locked = $this->lockThread($thread);
            $before = (bool) $locked->getAttribute($flag);
            $locked->forceFill([$flag => $value, $at => $value ? now() : null])->save();
            Audit::record($event->value, $locked, [$flag => $before], [$flag => $value], $reason, $staff);

            return $locked;
        });
    }

    private function lockThread(ForumThread $thread): ForumThread
    {
        /** @var ForumThread */
        return ForumThread::query()->whereKey($thread->id)->lockForUpdate()->firstOrFail();
    }
}
