<?php

namespace App\Actions\Messaging;

use App\Enums\ErrorCode;
use App\Enums\MessageReaction;
use App\Exceptions\ApiException;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\MessageReactionRow;
use App\Models\User;
use App\Services\Messaging\Reach;

/**
 * [SIG sig.msg_reactions] One reaction per member and message: a new one replaces the old; removing is idempotent.
 */
class ReactToMessage
{
    public function __construct(private readonly Reach $reach) {}

    /**
     * A reaction reaches the other side like a message: 403 cannot_message when it may not (a deleted account, a block), 403 inside a
     * pending request of the member (it would tell the sender that it was opened).
     */
    public function react(User $member, ConversationParticipant $me, Message $message, MessageReaction $reaction): void
    {
        if ($me->isPendingRequest()) {
            throw new ApiException(ErrorCode::Forbidden);
        }

        [$reason] = $this->reach->check($member, $me);

        if ($reason !== null) {
            throw DeliverMessage::cannotMessage($reason);
        }

        MessageReactionRow::query()->upsert(
            [['message_id' => $message->id, 'user_id' => $member->id, 'reaction' => $reaction->value, 'created_at' => now()]],
            ['message_id', 'user_id'],
            ['reaction', 'created_at'],
        );
    }

    public function remove(User $member, Message $message): void
    {
        MessageReactionRow::query()->where('message_id', $message->id)->where('user_id', $member->id)->delete();
    }
}
