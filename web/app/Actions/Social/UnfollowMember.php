<?php

namespace App\Actions\Social;

use App\Models\Follow;
use App\Models\User;

/**
 * Idempotent too: not following is the wanted state, so nothing to delete is no error.
 */
class UnfollowMember
{
    public function handle(User $follower, User $member): void
    {
        Follow::query()->where('follower_id', $follower->id)->where('followee_id', $member->id)->delete();
    }
}
