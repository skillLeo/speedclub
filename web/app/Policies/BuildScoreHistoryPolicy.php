<?php

namespace App\Policies;

use App\Models\BuildScoreHistory;
use App\Models\User;

/**
 * M5.9c: the day-by-day history of a Build Score is its owner's (Wrapped, INS-01).
 */
class BuildScoreHistoryPolicy
{
    public function view(User $user, BuildScoreHistory $history): bool
    {
        return $history->vehicle?->isOwnedBy($user) === true;
    }
}
