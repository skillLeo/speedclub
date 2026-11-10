<?php

namespace App\Actions\Messaging;

use App\Models\ConversationParticipant;
use App\Models\Message;

/**
 * What a send did: the sender's side of the conversation, the message, whether it was a replay of an earlier send, and whether the
 * conversation was new.
 */
final readonly class Delivery
{
    public function __construct(
        public ConversationParticipant $participant,
        public Message $message,
        public bool $replayed,
        public bool $created = false,
    ) {}
}
