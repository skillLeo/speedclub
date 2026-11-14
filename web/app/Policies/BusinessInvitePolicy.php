<?php

namespace App\Policies;

use App\Models\BusinessInvite;
use App\Models\User;

/**
 * SEC-414-01: only the invited member answers an invitation, while active (a suspended or deactivated member cannot join a team).
 * The owner's side (invite, withdraw) goes through BusinessPolicy::manage.
 */
class BusinessInvitePolicy
{
    public function respond(User $user, BusinessInvite $invite): bool
    {
        return $invite->user_id === $user->id && $user->isActive();
    }

    /**
     * Declining stays open to a member who is not active any more: saying no never needs more than being the invitee.
     */
    public function decline(User $user, BusinessInvite $invite): bool
    {
        return $invite->user_id === $user->id && ! $user->isDeactivated();
    }
}
