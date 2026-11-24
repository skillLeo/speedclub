<?php

namespace App\Policies;

use App\Enums\ForumThreadStatus;
use App\Enums\RestrictionType;
use App\Models\ForumThread;
use App\Models\User;
use App\Services\Forum\ForumVisibility;

/**
 * M5.8 forum threads (m5.8-contract §3). Guests read (ADR-124). The author sees their own thread in every state but deleted (pending,
 * rejected and removed with their status); everybody else a published thread in an open category of a visible author with no block
 * either way (ForumVisibility). A merged thread stays readable as the pointer to its target.
 */
class ForumThreadPolicy
{
    public function view(?User $user, ForumThread $thread): bool
    {
        if ($thread->trashed()) {
            return false;
        }

        if ($thread->isAuthoredBy($user) && $user !== null && ! $user->isDeactivated()) {
            return true;
        }

        if (! in_array($thread->status, [ForumThreadStatus::Published, ForumThreadStatus::Merged], true)) {
            return false;
        }

        return app(ForumVisibility::class)->threads($user, $thread->status)->whereKey($thread->id)->exists();
    }

    /**
     * Writing at all: an account that may act (not suspended or deactivated) without a publishing or forum restriction in force.
     */
    public function create(User $user): bool
    {
        return ! $user->isDeactivated() && ! $user->isSuspended()
            && ! $user->isRestrictedFrom(RestrictionType::Publishing) && ! $user->isRestrictedFrom(RestrictionType::Forum);
    }

    /**
     * Replying: a published thread the member can see, not locked.
     */
    public function reply(User $user, ForumThread $thread): bool
    {
        return $this->create($user) && $thread->isPublished() && ! $thread->is_locked && $this->view($user, $thread);
    }

    /**
     * The author edits title, text, category, tags and attachments while the thread is not removed or merged.
     */
    public function update(User $user, ForumThread $thread): bool
    {
        return $thread->isAuthoredBy($user) && $this->create($user) && ! $thread->trashed()
            && ! in_array($thread->status, [ForumThreadStatus::Removed, ForumThreadStatus::Merged], true);
    }

    /**
     * Also under a restriction: taking one's own content down always works.
     */
    public function delete(User $user, ForumThread $thread): bool
    {
        return $thread->isAuthoredBy($user) && ! $user->isDeactivated() && ! $thread->trashed();
    }

    /**
     * "Gelöst": the author of a published thread.
     */
    public function markSolution(User $user, ForumThread $thread): bool
    {
        return $thread->isAuthoredBy($user) && ! $user->isDeactivated() && $thread->isPublished();
    }

    public function subscribe(User $user, ForumThread $thread): bool
    {
        return ! $user->isDeactivated() && ! $user->isSuspended() && $thread->isPublished() && $this->view($user, $thread);
    }
}
