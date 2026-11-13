<?php

namespace App\Services\Messaging;

use App\Enums\MessageType;
use App\Models\Message;
use App\Models\Vehicle;

/**
 * One message as the reader sees it: what MessageResource renders. The vehicle only while the reader may view it; the quote of a reply
 * only while the reader still sees the quoted message.
 */
final readonly class MessageView
{
    /**
     * @param  list<array{key: string, count: int, mine: bool}>  $reactions
     * @param  array{id: string, type: MessageType, body: string|null, is_mine: bool, available: bool}|null  $replyTo  SM11's quote
     */
    public function __construct(
        public Message $message,
        public bool $mine,
        public ?Vehicle $vehicle,
        public array $reactions,
        public ?array $replyTo = null,
    ) {}
}
