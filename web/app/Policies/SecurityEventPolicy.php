<?php

namespace App\Policies;

use App\Models\SecurityEvent;
use App\Models\User;

/**
 * SET-21 rows (09 §8.4): only the member they are about reads them, and only through me/security-events (scoped to the member, so
 * another member's id is a 404). Rows are written by SecurityEventLog and FailedSignIns, never through a route.
 */
class SecurityEventPolicy
{
    public function view(User $user, SecurityEvent $event): bool
    {
        return $user->getKey() === $event->user_id && ! $user->isDeactivated();
    }
}
