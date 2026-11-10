<?php

namespace App\Actions\Messaging;

use App\Models\ConversationParticipant;
use App\Models\User;
use App\Services\Messaging\MessagingSignals;
use App\Services\Messaging\Reach;
use App\Services\Messaging\TypingSignals;

/**
 * [SIG sig.msg_typing] POST conversations/{id}/typing: typing_until = now + 5 s, and a Typing event while realtime is on. Silent (still
 * 204) around a pending request, so typing never tells a request's sender that it was opened.
 */
class SignalTyping
{
    public function __construct(
        private readonly Reach $reach,
        private readonly TypingSignals $typing,
        private readonly MessagingSignals $signals,
    ) {}

    public function handle(User $member, ConversationParticipant $me): void
    {
        [$reason, $other] = $this->reach->check($member, $me);

        // Silent as well when the other side cannot be reached (a deleted account, a closed setting before acceptance).
        if ($reason !== null || $me->isPendingRequest() || $other === null || $other->isPendingRequest() || $other->deleted_at !== null) {
            return;
        }

        $this->typing->mark($me->conversation_id, $me->user_id);
        $this->signals->typing($me->conversation_id);
    }
}
