<?php

namespace App\Policies;

use App\Models\ModerationCase;
use App\Models\User;

/**
 * Cases are staff work (ADM-20…24, Phase 3, through the staff guard and moderation.* permissions). No member reads one: a member sees
 * their reports and the decisions that concern them.
 */
class ModerationCasePolicy
{
    public function view(User $user, ModerationCase $case): bool
    {
        return false;
    }
}
