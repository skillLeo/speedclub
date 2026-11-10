<?php

namespace App\Policies;

use App\Models\PushToken;
use App\Models\User;

class PushTokenPolicy
{
    public function create(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    /**
     * DELETE me/push-tokens/{device_id}: the query only ever reaches the member's own rows.
     */
    public function deleteOwn(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function delete(User $user, PushToken $token): bool
    {
        return $token->user_id === $user->id;
    }
}
