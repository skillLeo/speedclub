<?php

namespace App\Actions\Messaging;

use App\Enums\CannotMessageReason;
use App\Enums\ErrorCode;
use App\Enums\MessageType;
use App\Exceptions\ApiException;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Services\Messaging\Conversations;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * POST conversations/{id}/messages. The caller found $mine as an active participant (else 404). Locks the conversation, then the sender's
 * side, then the other side, as every messaging write does.
 *
 * A reply (SM11, ADR-445) quotes a message of the same conversation that the sender sees now: not removed, not deleted for the sender,
 * not before the sender's clearing point. Anything else is 422 on `reply_to_id`, the same answer for a message of another conversation
 * as for one that never existed.
 */
class SendMessage
{
    public function __construct(
        private readonly DeliverMessage $deliver,
        private readonly Conversations $conversations,
    ) {}

    /**
     * @param  array{type: MessageType, body: string|null, media_id: string|null, vehicle_id: string|null, client_id: string, reply_to_id?: string|null}  $draft
     */
    public function handle(User $sender, ConversationParticipant $mine, array $draft, ?string $key): Delivery
    {
        $replay = $this->deliver->replay($sender, $draft, $key, $mine->conversation_id);

        if ($replay instanceof Message) {
            return new Delivery($mine, $replay, true);
        }

        $this->deliver->assertAttachable($sender, $mine->conversation_id, $draft);
        $this->assertQuotable($mine, $draft['reply_to_id'] ?? null);

        try {
            return DB::transaction(function () use ($sender, $mine, $draft, $key): Delivery {
                $conversation = Conversation::query()->whereKey($mine->conversation_id)->lockForUpdate()->firstOrFail();
                $locked = ConversationParticipant::query()->whereKey($mine->id)->lockForUpdate()->firstOrFail();
                $theirs = ConversationParticipant::query()->where('conversation_id', $conversation->id)->where('user_id', '!=', $sender->id)->lockForUpdate()->first();
                $recipient = $theirs === null ? null : User::withTrashed()->find($theirs->user_id);

                // A copy that committed while this waited for the lock.
                $replay = $this->deliver->replay($sender, $draft, $key, $conversation->id);

                if ($replay instanceof Message) {
                    return new Delivery($locked, $replay, true);
                }

                if (! $theirs instanceof ConversationParticipant || ! $recipient instanceof User) {
                    throw DeliverMessage::cannotMessage(CannotMessageReason::RecipientClosed);
                }

                $message = $this->deliver->deliver($sender, $recipient, $conversation, $locked, $theirs, $draft, $key);

                return new Delivery($locked->refresh(), $message, false);
            }, 3);
        } catch (UniqueConstraintViolationException) {
            // The same message from a parallel request won the unique index: answer as its replay.
            $replay = $this->deliver->replay($sender, $draft, $key, $mine->conversation_id);

            if (! $replay instanceof Message) {
                throw new \RuntimeException('A message insert collided without a stored copy.');
            }

            return new Delivery($mine->refresh(), $replay, true);
        }
    }

    private function assertQuotable(ConversationParticipant $mine, ?string $replyTo): void
    {
        if ($replyTo !== null && ! $this->conversations->visibleMessages($mine)->whereKey($replyTo)->exists()) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: ['reply_to_id' => [(string) __('messaging.reply_unavailable')]]);
        }
    }
}
