<?php

namespace App\Policies;

use App\Models\SocialAccount;
use App\Models\User;

/**
 * A linked provider belongs to one member. ManageProviders works on the signed-in member's own rows only; this keeps any later route on
 * the same rule.
 */
class SocialAccountPolicy
{
    public function view(User $user, SocialAccount $account): bool
    {
        return $account->user_id === $user->id;
    }

    public function delete(User $user, SocialAccount $account): bool
    {
        return $account->user_id === $user->id && ! $user->isDeactivated();
    }
}
