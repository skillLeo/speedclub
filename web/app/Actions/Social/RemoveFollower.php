<?php

namespace App\Actions\Social;

use App\Models\Follow;
use App\Models\User;

/**
 * PROF-04 "Entfernen" on the member's own Follower tab. The follower is not told and may follow again; blocking is the way to stop
 * that. Idempotent: no follow is the wanted state.
 */
class RemoveFollower
{
    public function handle(User $member, User $follower): void
    {
        Follow::query()->where('follower_id', $follower->id)->where('followee_id', $member->id)->delete();
    }
}
