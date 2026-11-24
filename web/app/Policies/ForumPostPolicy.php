<?php

namespace App\Policies;

use App\Enums\ForumPostStatus;
use App\Enums\ForumThreadStatus;
use App\Models\ForumPost;
use App\Models\User;
use App\Services\Forum\ForumVisibility;

/**
 * M5.8 forum posts (m5.8-contract §3). A post shows while published, of a visible author with no block either way, in a thread the reader
 * may see; its author sees it in every state but deleted. Votes: published replies of others in a published thread.
 */
class ForumPostPolicy
{
    public function view(?User $user, ForumPost $post): bool
    {
        if ($post->trashed()) {
            return false;
        }

        $thread = $post->thread;
        $threads = new ForumThreadPolicy;

        if ($user !== null && $post->user_id === $user->id && ! $user->isDeactivated()) {
            return $thread->trashed() === false && ($thread->isAuthoredBy($user) || $threads->view($user, $thread));
        }

        if (! $threads->view($user, $thread) || ($post->is_opening && $thread->status !== ForumThreadStatus::Published && ! $thread->isAuthoredBy($user))) {
            return false;
        }

        $query = ForumPost::query()->whereKey($post->id);
        app(ForumVisibility::class)->posts($query, $user);

        return $query->exists();
    }

    /**
     * The author, while the post and its thread are live. Never a removed post (it would launder an appeal: staff review the current text,
     * a reversal would republish an unreviewed one) or a rejected reply; a rejected thread is edited through PATCH forum/threads/{thread},
     * which sends it back to pre-moderation.
     */
    public function update(User $user, ForumPost $post): bool
    {
        $thread = $post->thread;

        return $post->user_id === $user->id && ! $post->trashed() && (new ForumThreadPolicy)->create($user)
            && ! in_array($post->status, [ForumPostStatus::Removed, ForumPostStatus::Rejected], true)
            && ! $thread->trashed() && ! in_array($thread->status, [ForumThreadStatus::Removed, ForumThreadStatus::Merged], true);
    }

    /**
     * Also under a restriction. The opening post goes with its thread (DELETE forum/threads/{thread}).
     */
    public function delete(User $user, ForumPost $post): bool
    {
        return $post->user_id === $user->id && ! $post->trashed() && ! $post->is_opening && ! $user->isDeactivated();
    }

    public function vote(User $user, ForumPost $post): bool
    {
        return (new ForumThreadPolicy)->create($user) && ! $post->is_opening && $post->isPublished()
            && $post->thread->isPublished() && $this->view($user, $post);
    }
}
