<?php

namespace App\Policies;

use App\Enums\CommentStatus;
use App\Models\Comment;
use App\Models\User;

/**
 * M4.11 [build_comments]. Writing is BuildUpdatePolicy::comment.
 */
class CommentPolicy
{
    /**
     * A visible comment on an update the member can see, of an author nobody hides (active, verified, no block either way).
     */
    public function view(?User $user, Comment $comment): bool
    {
        $author = $comment->user;

        if ($comment->trashed() || $comment->status !== CommentStatus::Visible || ! $author instanceof User || ! $author->isPubliclyVisible()) {
            return false;
        }

        if ($user !== null && ! $author->is($user) && $user->hasBlockWith($author)) {
            return false;
        }

        return (new BuildUpdatePolicy)->view($user, $comment->buildUpdate);
    }

    /**
     * The author, and the owner of the update (moderating their own build). Open under a restriction.
     */
    public function delete(User $user, Comment $comment): bool
    {
        if ($user->isDeactivated() || $comment->trashed()) {
            return false;
        }

        return $comment->user_id === $user->id || $comment->buildUpdate->vehicle->isOwnedBy($user);
    }
}
