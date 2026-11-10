<?php

namespace App\Actions\Messaging;

use App\Enums\CannotMessageReason;
use App\Enums\ConversationFolder;
use App\Enums\ErrorCode;
use App\Enums\MessageType;
use App\Exceptions\ApiException;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Messaging\Conversations;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * POST conversations (m2.4-contract §1, §2): one conversation per pair. Starting again, from a profile or another vehicle, reuses it; a
 * start from a vehicle sets the context card. A side that deleted the conversation, or had it closed by a block that is gone now, gets the
 * same row back with its history before the clearing point still hidden.
 */
class StartConversation
{
    public function __construct(
        private readonly DeliverMessage $deliver,
        private readonly Conversations $conversations,
    ) {}

    /**
     * @param  array{type: MessageType, body: string|null, media_id: string|null, vehicle_id: string|null, client_id: string}  $draft
     */
    public function handle(User $sender, User $recipient, ?string $contextVehicleId, array $draft, ?string $key): Delivery
    {
        $replay = $this->deliver->replay($sender, $draft, $key);

        if ($this->answersReplay($sender, $replay)) {
            return $this->replayed($sender, $replay, $recipient);
        }

        $context = $contextVehicleId === null ? null : $this->deliver->viewableVehicle($sender, $contextVehicleId, 'vehicle_id');

        if ($draft['type'] === MessageType::Vehicle) {
            $this->deliver->viewableVehicle($sender, $draft['vehicle_id'], 'message.vehicle_id');
        }

        try {
            return DB::transaction(fn (): Delivery => $this->start($sender, $recipient, $context, $draft, $key), 3);
        } catch (UniqueConstraintViolationException) {
            $replay = $this->deliver->replay($sender, $draft, $key);

            if (! $replay instanceof Message) {
                throw new \RuntimeException('A message insert collided without a stored copy.');
            }

            return $this->replayed($sender, $replay, $recipient);
        }
    }

    /**
     * @param  array{type: MessageType, body: string|null, media_id: string|null, vehicle_id: string|null, client_id: string}  $draft
     */
    private function start(User $sender, User $recipient, ?Vehicle $context, array $draft, ?string $key): Delivery
    {
        $now = now();
        $pair = Conversation::pairKey($sender, $recipient);

        $created = Conversation::query()->insertOrIgnore([
            'id' => (new Conversation)->newUniqueId(),
            'pair_key' => $pair,
            'created_by' => $sender->id,
            'created_at' => $now,
            'updated_at' => $now,
        ]) === 1;

        $conversation = Conversation::query()->where('pair_key', $pair)->lockForUpdate()->firstOrFail();

        $replay = $this->deliver->replay($sender, $draft, $key);

        if ($this->answersReplay($sender, $replay)) {
            return $this->replayed($sender, $replay, $recipient);
        }

        // New sides: the sender's in Chats, the recipient's as an unaccepted row whose folder DeliverMessage decides.
        ConversationParticipant::query()->insertOrIgnore([
            ['conversation_id' => $conversation->id, 'user_id' => $sender->id, 'folder' => ConversationFolder::Chats->value, 'accepted_at' => $now, 'unread_count' => 0, 'created_at' => $now, 'updated_at' => $now],
            ['conversation_id' => $conversation->id, 'user_id' => $recipient->id, 'folder' => ConversationFolder::Requests->value, 'accepted_at' => null, 'unread_count' => 0, 'created_at' => $now, 'updated_at' => $now],
        ]);

        $mine = ConversationParticipant::query()->where('conversation_id', $conversation->id)->where('user_id', $sender->id)->lockForUpdate()->firstOrFail();
        $theirs = ConversationParticipant::query()->where('conversation_id', $conversation->id)->where('user_id', $recipient->id)->lockForUpdate()->first();

        if (! $theirs instanceof ConversationParticipant) {
            throw DeliverMessage::cannotMessage(CannotMessageReason::RecipientClosed);
        }

        $message = $this->deliver->deliver($sender, $recipient, $conversation, $mine, $theirs, $draft, $key, $context);

        return new Delivery($mine->refresh(), $message, false, $created);
    }

    /**
     * A replay answers only while the sender still sees the conversation (SEC-P2-04). Across a block, or after "deleted for me", the request
     * takes the normal path and gets what a fresh one would (403 recipient_closed across a block), never the other member's live profile.
     *
     * @phpstan-assert-if-true Message $replay
     */
    private function answersReplay(User $sender, ?Message $replay): bool
    {
        return $replay instanceof Message && $this->conversations->participantFor($sender, $replay->conversation_id) !== null;
    }

    private function replayed(User $sender, Message $message, ?User $recipient = null): Delivery
    {
        // The same client_id in another conversation is another message, not this one's replay (review #16).
        if ($recipient !== null && Conversation::query()->whereKey($message->conversation_id)->value('pair_key') !== Conversation::pairKey($sender, $recipient)) {
            throw new ApiException(ErrorCode::IdempotencyKeyReused);
        }

        $mine = ConversationParticipant::query()->where('conversation_id', $message->conversation_id)->where('user_id', $sender->id)->firstOrFail();

        return new Delivery($mine, $message, true);
    }
}
