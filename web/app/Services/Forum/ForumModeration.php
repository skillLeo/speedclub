<?php

namespace App\Services\Forum;

use App\Enums\ForumPostStatus;
use App\Enums\ForumThreadStatus;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Media;
use App\Services\Media\MediaService;
use Closure;

/**
 * The forum side of a DSA decision (m5.8-contract D2, D4): remove_content takes the post out of every list (status removed); for an
 * opening post the whole thread goes with it, unpinned, and its photos stop being served at once (their public files are withdrawn after
 * the commit, ADR-123; the private originals stay for an appeal). A post that was the thread's solution stops being it. A reversal brings
 * all of it back from the snapshot taken before (ContentRestoration): status, pin, solution, and the photos drawn again from their
 * originals. Counters are recounted under the thread's lock. Runs inside DecideCase's transaction.
 */
final class ForumModeration
{
    public function __construct(
        private readonly ForumCounters $counters,
        private readonly MediaService $media,
    ) {}

    /**
     * @return array{status: string, thread_status: string|null, pinned: bool, solution: bool, solved_at: string|null}
     */
    public function snapshot(ForumPost $post): array
    {
        $thread = $post->thread;

        return [
            'status' => $post->status->value,
            'thread_status' => $post->is_opening ? $thread->status->value : null,
            'pinned' => $post->is_opening && $thread->is_pinned,
            'solution' => $thread->solved_post_id === $post->id,
            'solved_at' => $thread->solved_post_id === $post->id ? $thread->solved_at?->toIso8601String() : null,
        ];
    }

    /**
     * @return list<Closure(): void>
     */
    public function remove(ForumPost $post): array
    {
        $thread = $this->lockThread($post);
        $post->forceFill(['status' => ForumPostStatus::Removed])->save();

        if ($thread->solved_post_id === $post->id) {
            $thread->forceFill(['solved_post_id' => null, 'solved_at' => null])->save();
        }

        if ($post->is_opening && $thread->status !== ForumThreadStatus::Removed) {
            $thread->forceFill(['status' => ForumThreadStatus::Removed, 'is_pinned' => false, 'pinned_at' => null])->save();
        }

        $this->recount($thread);

        return $post->is_opening ? [$this->withdrawPhotos($post)] : [];
    }

    /**
     * @param  array<string, mixed>  $snapshot
     * @return list<Closure(): void>
     */
    public function restore(ForumPost $post, array $snapshot): array
    {
        $thread = $this->lockThread($post);
        $before = ForumPostStatus::tryFrom(is_string($snapshot['status'] ?? null) ? $snapshot['status'] : '');
        $post->forceFill(['status' => $before === null || $before === ForumPostStatus::Removed ? ForumPostStatus::Published : $before])->save();

        if ($post->is_opening && $thread->status === ForumThreadStatus::Removed) {
            $threadBefore = ForumThreadStatus::tryFrom(is_string($snapshot['thread_status'] ?? null) ? $snapshot['thread_status'] : '');
            $pinned = ($snapshot['pinned'] ?? false) === true;
            $thread->forceFill([
                'status' => $threadBefore === null || $threadBefore === ForumThreadStatus::Removed ? ForumThreadStatus::Published : $threadBefore,
                'is_pinned' => $pinned,
                'pinned_at' => $pinned ? now() : null,
            ])->save();
        }

        // The solution comes back unless the author picked another one meanwhile.
        if (($snapshot['solution'] ?? false) === true && $thread->solved_post_id === null) {
            $thread->forceFill(['solved_post_id' => $post->id, 'solved_at' => is_string($snapshot['solved_at'] ?? null) ? $snapshot['solved_at'] : now()])->save();
        }

        $this->recount($thread);

        return $post->is_opening ? [$this->republishPhotos($post)] : [];
    }

    /**
     * Public files of the opening post's photos go now (removal, a rejected pre-moderation thread); the originals stay.
     *
     * @return Closure(): void
     */
    public function withdrawPhotos(ForumPost $opening): Closure
    {
        $ids = $opening->photos()->pluck('id')->all();

        return function () use ($ids): void {
            foreach (Media::query()->whereKey($ids)->get() as $photo) {
                $this->media->withdraw($photo);
            }
        };
    }

    /**
     * @return Closure(): void
     */
    public function republishPhotos(ForumPost $opening): Closure
    {
        $ids = $opening->photos()->pluck('id')->all();

        return function () use ($ids): void {
            foreach (Media::query()->whereKey($ids)->get() as $photo) {
                $this->media->republish($photo);
            }
        };
    }

    private function lockThread(ForumPost $post): ForumThread
    {
        /** @var ForumThread $thread */
        $thread = ForumThread::withTrashed()->whereKey($post->thread_id)->lockForUpdate()->firstOrFail();
        $post->setRelation('thread', $thread);

        return $thread;
    }

    private function recount(ForumThread $thread): void
    {
        $this->counters->thread($thread);
        $this->counters->category($thread->category_id);
    }
}
