<?php

namespace App\Actions\Gift;

use App\Models\User;
use App\Models\UserBadge;

/**
 * POST me/badges/seen (m5.9d contract §2, §10.2): the unlock toast showed these badges; they never come in `?unseen=1` again. Keys the
 * member has not earned, or saw before, change nothing.
 */
final class MarkBadgesSeen
{
    /**
     * @param  list<string>  $keys
     */
    public function handle(User $member, array $keys): int
    {
        if ($keys === []) {
            return 0;
        }

        return UserBadge::query()->where('user_id', $member->id)->whereIn('badge_key', $keys)->whereNull('seen_at')->update(['seen_at' => now()]);
    }
}
