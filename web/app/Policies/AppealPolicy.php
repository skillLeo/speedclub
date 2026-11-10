<?php

namespace App\Policies;

use App\Models\Appeal;
use App\Models\User;

/**
 * A member sees their own appeal, through the decision it belongs to (SAFE-01). Deciding is staff work (ADM-24, Phase 3).
 */
class AppealPolicy
{
    public function view(User $user, Appeal $appeal): bool
    {
        return ! $user->isDeactivated() && $appeal->appellant_id === $user->id;
    }
}
