<?php

namespace App\Services\Messaging;

use App\Events\ConversationRead;
use App\Events\MessageSent;
use App\Events\MessagingEvent;
use App\Events\Typing;
use App\Events\UnreadChanged;

/**
 * Which realtime events a change sends, and to whom (m2.4-contract §3). Ids only; through Realtime, after the response.
 */
class MessagingSignals
{
    public function __construct(private readonly Realtime $realtime) {}

    public function messageSent(string $conversationId, string $messageId, string $senderId, string $recipientId): void
    {
        $this->realtime->dispatch(
            new MessageSent([MessagingEvent::conversationChannel($conversationId), MessagingEvent::userChannel($recipientId)], $conversationId, $messageId),
            new UnreadChanged([MessagingEvent::userChannel($recipientId), MessagingEvent::userChannel($senderId)], $conversationId),
        );
    }

    /**
     * $receipts: read receipts apply now (both send them, neither side is a request). Without them only the reader's own devices hear it.
     */
    public function read(string $conversationId, string $messageId, string $readerId, bool $receipts): void
    {
        $events = [new UnreadChanged([MessagingEvent::userChannel($readerId)], $conversationId)];

        if ($receipts) {
            $events[] = new ConversationRead([MessagingEvent::conversationChannel($conversationId)], $conversationId, $messageId);
        }

        $this->realtime->dispatch(...$events);
    }

    public function typing(string $conversationId): void
    {
        $this->realtime->dispatch(new Typing([MessagingEvent::conversationChannel($conversationId)], $conversationId));
    }

    /**
     * Counters of these members changed (accept, decline, delete, block).
     */
    public function unreadChanged(?string $conversationId, string ...$userIds): void
    {
        if ($userIds === []) {
            return;
        }

        $this->realtime->dispatch(new UnreadChanged(array_values(array_map(MessagingEvent::userChannel(...), $userIds)), $conversationId));
    }
}
