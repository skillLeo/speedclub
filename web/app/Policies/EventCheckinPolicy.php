<?php

namespace App\Policies;

use App\Models\EventCheckin;
use App\Models\User;

/**
 * M5.6 "War dabei": a check-in is its member's alone to see in full, change and take back (also under a restriction: it is their data).
 * Others read it only through the public list of ended events (MemberCheckinsController), never one by one.
 */
class EventCheckinPolicy
{
    public function view(User $user, EventCheckin $checkin): bool
    {
        return $checkin->user_id === $user->id && ! $user->isDeactivated();
    }

    public function update(User $user, EventCheckin $checkin): bool
    {
        return $this->view($user, $checkin);
    }

    public function delete(User $user, EventCheckin $checkin): bool
    {
        return $this->view($user, $checkin);
    }
}
