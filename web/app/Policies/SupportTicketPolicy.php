<?php

namespace App\Policies;

use App\Models\SupportTicket;
use App\Models\User;

/**
 * SET-15. Open to unverified and restricted members: support is how they get help with exactly that.
 */
class SupportTicketPolicy
{
    public function create(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function view(User $user, SupportTicket $ticket): bool
    {
        return ! $user->isDeactivated() && $ticket->user_id === $user->id;
    }

    /** SET-15b: the member writes again in their own thread, also after it was closed (it opens again). */
    public function reply(User $user, SupportTicket $ticket): bool
    {
        return $this->view($user, $ticket);
    }
}
