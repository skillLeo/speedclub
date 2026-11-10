<?php

namespace App\Actions\Messaging;

use App\Enums\ConversationFolder;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\ConversationParticipant;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Messaging\Conversations;
use App\Services\Messaging\MessagingSignals;
use Illuminate\Support\Facades\DB;

/**
 * POST conversations/{id}/read: the read mark moves forward to a message the reader sees, and the unread count follows. A request is
 * never marked read (MSG-04): the call answers 204 and changes nothing, so its sender cannot learn that it was opened. The other side
 * hears of it (ConversationRead) only while read receipts apply.
 */
class MarkConversationRead
{
    public function __construct(
        private readonly Conversations $conversations,
        private readonly MessagingSignals $signals,
        private readonly FeatureFlags $flags,
    ) {}

    public function handle(User $reader, ConversationParticipant $me, string $messageId): void
    {
        if ($me->isPendingRequest()) {
            return;
        }

        if (! $this->conversations->visibleMessages($me)->whereKey($messageId)->exists()) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: ['message_id' => [(string) __('validation.exists', ['attribute' => 'message_id'])]]);
        }

        $moved = DB::transaction(function () use ($me, $messageId): bool {
            $locked = ConversationParticipant::query()->whereKey($me->id)->lockForUpdate()->firstOrFail();

            if ($locked->last_read_message_id !== null && strcmp($locked->last_read_message_id, $messageId) >= 0) {
                return false;
            }

            $unread = $this->conversations->visibleMessages($locked)
                ->where('messages.id', '>', $messageId)
                ->where(fn ($query) => $query->where('messages.sender_id', '!=', $locked->user_id)->orWhereNull('messages.sender_id'))
                ->count();

            ConversationParticipant::query()->whereKey($locked->id)->toBase()->update([
                'last_read_message_id' => $messageId,
                'last_read_at' => now(),
                'unread_count' => $unread,
                'updated_at' => now(),
            ]);

            return true;
        });

        if ($moved) {
            $this->signals->read($me->conversation_id, $messageId, $reader->id, $this->receiptsApply($reader, $me));
        }
    }

    private function receiptsApply(User $reader, ConversationParticipant $me): bool
    {
        $other = $this->conversations->otherOf($me);
        $otherUser = $other === null ? null : User::query()->find($other->user_id);

        return $this->flags->enabled('sig.msg_read_receipts')
            && $other !== null && $otherUser instanceof User
            && $other->folder === ConversationFolder::Chats && $me->folder === ConversationFolder::Chats
            && $reader->getAttribute('read_receipts') !== false && $otherUser->getAttribute('read_receipts') !== false;
    }
}
