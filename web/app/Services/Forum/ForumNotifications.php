<?php

namespace App\Services\Forum;

use App\Jobs\Forum\NotifyForumPost;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\User;
use App\Services\Notifications\Notifier;
use App\Services\Social\Mentions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Throwable;

/**
 * The forum's notifications (m5.8-contract §5), only for published posts (a pending post notifies once it is approved):
 *
 * - forum_reply to the thread's author and subscribers, and to the author of the post a nested reply answers (NotifyForumPost, queued);
 * - forum_mention to members mentioned for the first time (Mentions: privacy, blocks, the `mentions` flag);
 * - forum_solved to the author of the reply marked as the solution.
 *
 * Every recipient must be able to see the thread and the post (ForumThreadPolicy / ForumPostPolicy); Notifier adds blocks, quiet hours,
 * the SET-09 switch and the push limits. A failure never fails the member's write.
 */
final class ForumNotifications
{
    private const SLICE = 100;

    public function __construct(
        private readonly Notifier $notifier,
        private readonly Mentions $mentions,
    ) {}

    /**
     * After a post became public (created published, or approved): mentions now, replies through the queue. Call inside the write's
     * transaction; the work runs after the commit.
     */
    public function published(ForumPost $post): void
    {
        $author = $post->user;

        if (! $author instanceof User) {
            return;
        }

        $new = $this->mentions->sync($post, $author, $post->body);

        DB::afterCommit(function () use ($post, $author, $new): void {
            foreach ($new as $member) {
                $this->safely(fn () => $this->canSee($member, $post) ? $this->notifier->forumMention($member, $author, $post->thread, $post) : null);
            }

            if (! $post->is_opening) {
                NotifyForumPost::dispatch($post->id);
            }
        });
    }

    /**
     * Mentions added by an edit of a published post.
     */
    public function edited(ForumPost $post): void
    {
        if ($post->isPublished()) {
            $author = $post->user;

            if ($author instanceof User) {
                $new = $this->mentions->sync($post, $author, $post->body);
                DB::afterCommit(function () use ($post, $author, $new): void {
                    foreach ($new as $member) {
                        $this->safely(fn () => $this->canSee($member, $post) ? $this->notifier->forumMention($member, $author, $post->thread, $post) : null);
                    }
                });
            }
        }
    }

    /**
     * One slice of the reply fan-out; the user id to continue after, or null when done.
     */
    public function replyFanout(ForumPost $post, ?string $after, float $deadline): ?string
    {
        $thread = $post->thread;
        $actor = $post->user;

        if (! $actor instanceof User || ! $thread->isPublished()) {
            return null;
        }

        // The author of the post a nested reply answers hears it first, and only once (not again as a subscriber).
        $answered = $post->parent?->user_id;

        if ($after === null && is_string($answered) && $answered !== $actor->id) {
            $member = User::query()->find($answered);

            if ($member instanceof User) {
                $this->safely(fn () => $this->canSee($member, $post) ? $this->notifier->forumReply($member, $actor, $thread, $post, 'post') : null);
            }
        }

        do {
            $ids = DB::table('forum_subscriptions')->where('thread_id', $thread->id)
                ->when($after !== null, fn ($query) => $query->where('user_id', '>', $after))
                ->orderBy('user_id')->limit(self::SLICE)->pluck('user_id')->map(strval(...))->all();
            $members = User::query()->whereKey($ids)->get()->keyBy('id');

            foreach ($ids as $id) {
                $after = $id;
                $member = $members->get($id);

                if (! $member instanceof User || $member->is($actor) || $id === $answered) {
                    continue;
                }

                $this->safely(fn () => $this->canSee($member, $post) ? $this->notifier->forumReply($member, $actor, $thread, $post, 'thread') : null);
            }

            if (count($ids) === self::SLICE && microtime(true) > $deadline) {
                return $after;
            }
        } while (count($ids) === self::SLICE);

        return null;
    }

    public function solved(ForumThread $thread, ForumPost $post): void
    {
        $author = $post->user;

        if (! $author instanceof User || $thread->isAuthoredBy($author)) {
            return;
        }

        DB::afterCommit(fn () => $this->safely(fn () => $this->canSee($author, $post) ? $this->notifier->forumSolved($author, $thread, $post) : null));
    }

    private function canSee(User $member, ForumPost $post): bool
    {
        $gate = Gate::forUser($member);

        return $gate->allows('view', $post->thread) && $gate->allows('view', $post);
    }

    /**
     * @param  callable(): mixed  $work
     */
    private function safely(callable $work): void
    {
        try {
            $work();
        } catch (Throwable $exception) {
            report($exception);
        }
    }
}
