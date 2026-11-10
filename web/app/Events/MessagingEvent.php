<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

/**
 * Realtime events of M2.4 (m2.4-contract §3). Sent at once (no queue), after the response, through App\Services\Messaging\Realtime.
 * The payload is exactly {conversation_id, message_id}: ids only, never a body, a name or a read state the receiver may not see. The
 * client fetches what changed (`messages?after=`, `conversations/{id}`, `notifications/unread-count`).
 *
 * Event names on the wire are the class names in App\Events, as Echo expects them with its default namespace: MessageSent,
 * ConversationRead, Typing, UnreadChanged.
 */
abstract class MessagingEvent implements ShouldBroadcastNow
{
    /**
     * @param  list<string>  $channels  channel names without the private- prefix: conversation.{id}, user.{id}
     */
    public function __construct(
        public readonly array $channels,
        public readonly ?string $conversationId,
        public readonly ?string $messageId = null,
    ) {}

    /**
     * @return list<PrivateChannel>
     */
    public function broadcastOn(): array
    {
        return array_map(fn (string $name): PrivateChannel => new PrivateChannel($name), $this->channels);
    }

    /**
     * @return array{conversation_id: string|null, message_id: string|null}
     */
    public function broadcastWith(): array
    {
        return ['conversation_id' => $this->conversationId, 'message_id' => $this->messageId];
    }

    public static function conversationChannel(string $conversationId): string
    {
        return 'conversation.'.$conversationId;
    }

    public static function userChannel(string $userId): string
    {
        return 'user.'.$userId;
    }
}
