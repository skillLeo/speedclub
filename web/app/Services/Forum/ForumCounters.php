<?php

namespace App\Services\Forum;

use App\Enums\ForumPostStatus;
use App\Enums\ForumThreadStatus;
use App\Models\ForumCategory;
use App\Models\ForumPost;
use App\Models\ForumThread;
use Carbon\CarbonImmutable;

/**
 * The denormalised counters of a thread (replies_count, last activity, last post and poster) and of its category (threads_count,
 * admin only), recounted from the rows after every change that can move them. Counted over published, not deleted rows; who the reader
 * is does not change them (a block hides the post, not the number).
 */
final class ForumCounters
{
    public function thread(ForumThread $thread): void
    {
        $replies = ForumPost::query()->where('thread_id', $thread->id)->where('is_opening', false)
            ->where('status', ForumPostStatus::Published->value);
        $last = (clone $replies)->orderByDesc('published_at')->orderByDesc('id')->first(['id', 'user_id', 'published_at']);
        $count = (clone $replies)->count();

        $published = $thread->published_at ?? $thread->created_at;
        $lastAt = $last?->published_at;
        $activity = $lastAt instanceof CarbonImmutable && ($published === null || $lastAt->greaterThan($published)) ? $lastAt : $published;

        $values = [
            'replies_count' => $count,
            'last_activity_at' => $activity,
            'last_post_id' => $last?->id,
            'last_poster_id' => $last?->user_id,
        ];

        ForumThread::withTrashed()->whereKey($thread->id)->toBase()->update([...$values, 'last_activity_at' => $activity?->toDateTimeString()]);
        $thread->forceFill($values)->syncOriginalAttributes(array_keys($values));
    }

    public function category(int ...$ids): void
    {
        foreach (array_unique($ids) as $id) {
            ForumCategory::query()->whereKey($id)->update([
                'threads_count' => ForumThread::query()->where('category_id', $id)->where('status', ForumThreadStatus::Published->value)->count(),
            ]);
        }
    }
}
