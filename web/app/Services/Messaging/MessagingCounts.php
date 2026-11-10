<?php

namespace App\Services\Messaging;

use App\Enums\InboxFolder;
use App\Models\User;

/**
 * The Nachrichten tab badge (m2.4-contract §4): `messages` = unread messages in Chats that are not muted (archived chats left out),
 * `requests` = open message requests. Read with the same filters as the inbox, so a badge never counts a row the inbox does not show.
 */
class MessagingCounts
{
    public function __construct(private readonly Conversations $conversations) {}

    /**
     * @return array{messages: int, requests: int}
     */
    public function for(User $member): array
    {
        $messages = $this->conversations->inboxQuery($member, InboxFolder::Chats)
            ->where('p.muted_indefinitely', false)
            ->where(fn ($query) => $query->whereNull('p.muted_until')->orWhere('p.muted_until', '<=', now()))
            ->sum('p.unread_count');

        return [
            'messages' => (int) $messages,
            'requests' => $this->conversations->inboxQuery($member, InboxFolder::Requests)->count(),
        ];
    }
}
