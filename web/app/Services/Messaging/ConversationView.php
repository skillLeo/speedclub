<?php

namespace App\Services\Messaging;

use App\Enums\CannotMessageReason;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Models\Vehicle;

/**
 * One conversation as one member sees it: what ConversationResource renders. Built by ConversationViews, which loads a whole page at
 * once. Holds nothing the member may not see: the vehicle only while the member may view it, the other side's read mark only while read
 * receipts apply, typing only outside a pending request.
 */
final readonly class ConversationView
{
    public function __construct(
        public ConversationParticipant $me,
        public ?ConversationParticipant $other,
        public ?User $otherUser,
        public Conversation $conversation,
        public ?Vehicle $vehicle,
        public ?Message $preview,
        public ?CannotMessageReason $cannotSend,
        public bool $requestPending,
        public bool $otherTyping = false,
        public ?string $otherReadMessageId = null,
    ) {}

    /**
     * The account is gone: hard-deleted, soft-deleted or deactivated. Shown as "Gelöschtes Mitglied".
     */
    public function otherDeleted(): bool
    {
        return $this->otherUser === null || $this->otherUser->isDeactivated();
    }
}
