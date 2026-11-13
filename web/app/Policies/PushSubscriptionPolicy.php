<?php

namespace App\Policies;

use App\Models\User;

/**
 * M4.15 (ADR-452): Web Push subscriptions follow the app's push tokens (PushTokenPolicy): open to every member who can still sign in,
 * restricted and suspended members included, as notices about their account reach them too; a deactivated account has none.
 */
class PushSubscriptionPolicy
{
    public function create(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    /**
     * DELETE me/push-subscriptions: the query only ever reaches the member's own rows.
     */
    public function deleteOwn(User $user): bool
    {
        return ! $user->isDeactivated();
    }
}
