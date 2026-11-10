<?php

namespace App\Services\Notifications;

/**
 * The bell and the tab badges: notifications (HOME-02), messages and requests (M2.4, App\Services\Messaging\MessagingCounts).
 */
final readonly class UnreadCounts
{
    public function __construct(
        public int $notifications,
        public int $messages = 0,
        public int $requests = 0,
    ) {}
}
