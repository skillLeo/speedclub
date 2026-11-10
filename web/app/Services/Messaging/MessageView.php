<?php

namespace App\Services\Messaging;

use App\Models\Message;
use App\Models\Vehicle;

/**
 * One message as the reader sees it: what MessageResource renders. The vehicle only while the reader may view it.
 */
final readonly class MessageView
{
    /**
     * @param  list<array{key: string, count: int, mine: bool}>  $reactions
     */
    public function __construct(
        public Message $message,
        public bool $mine,
        public ?Vehicle $vehicle,
        public array $reactions,
    ) {}
}
