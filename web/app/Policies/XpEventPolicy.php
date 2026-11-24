<?php

namespace App\Policies;

use App\Models\User;
use App\Models\XpEvent;

/**
 * M5.9d: the XP ledger is the member's own and written by App\Services\Progress\Xp only.
 */
class XpEventPolicy
{
    public function view(User $user, XpEvent $event): bool
    {
        return $event->user_id === $user->id;
    }
}
