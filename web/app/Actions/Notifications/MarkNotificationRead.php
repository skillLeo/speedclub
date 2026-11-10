<?php

namespace App\Actions\Notifications;

use App\Models\Notification;

class MarkNotificationRead
{
    /**
     * Reading keeps the first time it was read.
     */
    public function handle(Notification $notification, bool $read): Notification
    {
        if ($read && $notification->getAttribute('read_at') === null) {
            $notification->forceFill(['read_at' => now()])->save();
        } elseif (! $read && $notification->getAttribute('read_at') !== null) {
            $notification->forceFill(['read_at' => null])->save();
        }

        return $notification;
    }
}
