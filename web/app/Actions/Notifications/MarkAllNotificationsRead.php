<?php

namespace App\Actions\Notifications;

use App\Models\Notification;
use App\Models\User;

/**
 * "Alle als gelesen markieren" (HOME-02): every unread row of the member, also those the list leaves out for now.
 */
class MarkAllNotificationsRead
{
    public function handle(User $member): int
    {
        return Notification::query()
            ->where('notifiable_id', $member->id)
            ->whereNull('read_at')
            ->update(['read_at' => now()]);
    }
}
