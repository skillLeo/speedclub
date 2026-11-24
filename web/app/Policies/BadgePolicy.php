<?php

namespace App\Policies;

use App\Models\Badge;
use App\Models\User;

/**
 * M5.9d: active badges are part of every member's list (GET me/badges); members never write them (the admin badge manager's actions
 * check the staff atom content.edit).
 */
class BadgePolicy
{
    public function view(?User $user, Badge $badge): bool
    {
        return $badge->active;
    }
}
