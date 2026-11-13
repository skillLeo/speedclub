<?php

namespace App\Services\Messaging;

use App\Models\PushToken;
use App\Models\User;
use App\Services\Notifications\ExpoPush;
use App\Services\Notifications\WebPush;

/**
 * new_message and message_request pushes (02_PRODUCT_SPEC §7, m2.4-contract §4). No row in the notification list: the tab badge counts
 * from the participants. A push goes after the response (ADR-010) and is decided again when it runs (SendMessagePush, ADR-197).
 */
class MessagePushes
{
    public function __construct(private readonly ExpoPush $push, private readonly WebPush $webPush) {}

    public function queue(User $recipient, User $sender, string $conversationId, string $messageId): void
    {
        // M4.15: an app install or, with Web Push on, a browser of the member web.
        if (! ($this->push->enabled() && PushToken::query()->where('user_id', $recipient->id)->exists()) && ! $this->webPush->reaches($recipient)) {
            return;
        }

        SendMessagePush::dispatchAfterResponse($recipient->id, $sender->id, $conversationId, $messageId);
    }
}
