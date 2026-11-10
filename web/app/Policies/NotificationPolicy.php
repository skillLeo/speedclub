<?php

namespace App\Policies;

use App\Models\Notification;
use App\Models\User;

/**
 * HOME-02. Every member reads and marks only their own rows; another member's row is a 404 (the query never finds it). A deactivated
 * account has none to read. Restrictions and suspensions do not hide them: a decision about the account arrives here too (M2.6).
 */
class NotificationPolicy
{
    public function viewAny(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function update(User $user, Notification $notification): bool
    {
        return ! $user->isDeactivated() && $notification->notifiable_id === $user->id;
    }
}
