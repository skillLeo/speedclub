<?php

namespace App\Policies;

use App\Enums\ErrorCode;
use App\Models\Follow;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class FollowPolicy
{
    /**
     * Unverified accounts cannot follow (02_PRODUCT_SPEC §3.1), and blocks prevent follows (§3.5).
     */
    public function create(User $user, User $member): Response|bool
    {
        if ($user->is($member) || ! $user->isActive() || ! $member->isPubliclyVisible() || $user->hasBlockWith($member)) {
            return false;
        }

        return $user->hasVerifiedEmail() ? true : Response::deny(code: ErrorCode::EmailNotVerified->value);
    }

    /**
     * DELETE me/followers/{x} before any lookup: a deactivated account gets 403 whether or not the follow exists, as for block and save.
     */
    public function removeFollower(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    /**
     * Unfollow, or remove a follower (PROF-04). Not for a deactivated account, as block and save (M2.1 review #9).
     */
    public function delete(User $user, Follow $follow): bool
    {
        return ! $user->isDeactivated() && ($follow->follower_id === $user->id || $follow->followee_id === $user->id);
    }
}
