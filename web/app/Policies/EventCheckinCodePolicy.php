<?php

namespace App\Policies;

use App\Models\EventCheckinCode;
use App\Models\User;

/**
 * M5.6: a check-in code is shown to the organiser of its event only (EventPolicy::showCheckinCode decides the route).
 */
class EventCheckinCodePolicy
{
    public function view(User $user, EventCheckinCode $code): bool
    {
        return $code->event->isOrganisedBy($user) && $user->isActive();
    }
}
