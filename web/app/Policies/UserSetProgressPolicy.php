<?php

namespace App\Policies;

use App\Models\User;
use App\Models\UserSetProgress;

/**
 * M5.9b: a member's set progress is theirs alone (GET me/dex/sets); written by App\Services\Dex\DexSets only.
 */
class UserSetProgressPolicy
{
    public function view(User $user, UserSetProgress $progress): bool
    {
        return $progress->user_id === $user->id && ! $user->isDeactivated();
    }
}
