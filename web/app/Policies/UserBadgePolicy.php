<?php

namespace App\Policies;

use App\Models\User;
use App\Models\UserBadge;

/**
 * M5.9d: an earned badge is the member's own (marking it seen); others see earned badges through the public list only.
 */
class UserBadgePolicy
{
    public function update(User $user, UserBadge $badge): bool
    {
        return $badge->user_id === $user->id;
    }
}
