<?php

namespace App\Policies;

use App\Models\TicketMessage;
use App\Models\User;

/**
 * Members write the first message through SET-15 only; replies come with ADM-25 (Phase 3).
 */
class TicketMessagePolicy
{
    public function view(User $user, TicketMessage $message): bool
    {
        return ! $user->isDeactivated() && $message->ticket?->user_id === $user->id;
    }
}
