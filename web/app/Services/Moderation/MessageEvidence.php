<?php

namespace App\Services\Moderation;

use App\Models\Message;
use Illuminate\Container\Attributes\Bind;

/**
 * What a message report keeps for the case (m2.6-contract §2, ADM-22): the reported message and, when the reporter agreed to send the
 * context, up to the configured number of messages before and after it in the same conversation. Nothing else of the thread.
 */
#[Bind(MessagesTableEvidence::class)]
interface MessageEvidence
{
    /**
     * @return list<array{id: string, from: 'reported'|'reporter'|'other', type: string, body: string|null, media_id: string|null, vehicle_id: string|null, created_at: string|null, reported: bool}>
     */
    public function snapshot(Message $message, string $reporterId, bool $withContext): array;
}
