<?php

namespace App\Actions\Messaging;

use App\Enums\ConversationFolder;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\User;
use App\Services\Messaging\Conversations;
use App\Services\Messaging\MessagingSignals;
use Illuminate\Support\Facades\DB;

/**
 * POST conversations/{id}/accept and /decline (MSG-04), for the recipient of a request only; anything else is 404.
 *
 * Accept moves it to Chats and counts what it holds as read. Decline hides it for the recipient (deleted_at, cleared up to its last
 * message) and tells the sender nothing: the sender's next message still answers request_pending.
 */
class AnswerRequest
{
    public function __construct(
        private readonly Conversations $conversations,
        private readonly MessagingSignals $signals,
    ) {}

    public function accept(User $member, ConversationParticipant $me): ConversationParticipant
    {
        DB::transaction(function () use ($me): void {
            $conversation = Conversation::query()->whereKey($me->conversation_id)->lockForUpdate()->firstOrFail();
            $locked = $this->pending($me);
            $last = $this->conversations->visibleMessages($locked)->max('messages.id');

            ConversationParticipant::query()->whereKey($locked->id)->toBase()->update([
                'folder' => ConversationFolder::Chats->value,
                'accepted_at' => now(),
                'last_read_message_id' => is_string($last) ? $last : $locked->last_read_message_id,
                'last_read_at' => now(),
                'unread_count' => 0,
                'updated_at' => now(),
                'last_message_at' => $conversation->getRawOriginal('last_message_at'),
            ]);
        });

        $this->signals->unreadChanged($me->conversation_id, $member->id);

        return $me->refresh();
    }

    public function decline(User $member, ConversationParticipant $me): void
    {
        DB::transaction(function () use ($me): void {
            $conversation = Conversation::query()->whereKey($me->conversation_id)->lockForUpdate()->firstOrFail();
            $locked = $this->pending($me);

            ConversationParticipant::query()->whereKey($locked->id)->toBase()->update([
                'deleted_at' => now(),
                'declined_at' => now(),
                'cleared_before_message_id' => $conversation->last_message_id,
                'unread_count' => 0,
                'updated_at' => now(),
            ]);
        });

        $this->signals->unreadChanged($me->conversation_id, $member->id);
    }

    private function pending(ConversationParticipant $me): ConversationParticipant
    {
        $locked = ConversationParticipant::query()->whereKey($me->id)->whereNull('deleted_at')->lockForUpdate()->first();

        if (! $locked instanceof ConversationParticipant || ! $locked->isPendingRequest()) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return $locked;
    }
}
