<?php

namespace App\Actions\Messaging;

use App\Enums\CannotMessageReason;
use App\Enums\ConversationFolder;
use App\Enums\ErrorCode;
use App\Enums\KeywordField;
use App\Enums\MediaStatus;
use App\Enums\MessageType;
use App\Exceptions\ApiException;
use App\Http\RateLimits;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Media;
use App\Models\Message;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Messaging\MessageIds;
use App\Services\Messaging\MessagePushes;
use App\Services\Messaging\MessagingSignals;
use App\Services\Rules\ContentScreen;
use App\Services\Social\MessagingEligibility;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;

/**
 * The one way a message enters a conversation (m2.4-contract §1, §2), shared by POST conversations and POST conversations/{id}/messages.
 * "Instant and safe":
 *
 * - **Never twice:** a message is the sender's (client_id) and, when sent, (Idempotency-Key). A retry with the same payload gets the
 *   first message back (replayed); the same ids with another payload are 409 idempotency_key_reused. Two copies racing each other meet
 *   at the unique index, and the loser answers as a replay. The answer is rebuilt from the row, so no body is stored anywhere else
 *   (the generic idempotency middleware would keep the response body for 24 h; ADR-125).
 * - **Never lost to polling:** under the conversation's row lock, ids increase strictly (MessageIds).
 * - **Requests:** a recipient who has not accepted the conversation and does not follow the sender gets it in Anfragen, with one message
 *   of the sender at most (409 request_pending for the next; the sender never learns of a read or a decline). A recipient who follows the
 *   sender gets it in Chats. Writing in a request accepts it.
 * - **Who may write** is MessagingEligibility, read under the lock; a block is recipient_closed.
 * - Events and the push go out after the commit and after the response.
 *
 * Must run inside a transaction that holds the conversation and both participant rows locked (deliver()).
 */
class DeliverMessage
{
    public function __construct(
        private readonly MessagingEligibility $eligibility,
        private readonly MessagingSignals $signals,
        private readonly MessagePushes $pushes,
        private readonly ContentScreen $screen,
    ) {}

    /**
     * The sender's earlier copy of this message, or null. Throws 409 idempotency_key_reused for the same ids with another payload.
     *
     * @param  array{type: MessageType, body: string|null, media_id: string|null, vehicle_id: string|null, client_id: string}  $draft
     */
    public function replay(User $sender, array $draft, ?string $key, ?string $conversationId = null): ?Message
    {
        $existing = Message::withTrashed()
            ->where('sender_id', $sender->id)
            ->where(fn ($query) => $query->where('client_id', $draft['client_id'])->when($key !== null, fn ($either) => $either->orWhere('idempotency_key', $key)))
            ->orderByRaw('client_id = ? DESC', [$draft['client_id']])
            ->first();

        if (! $existing instanceof Message) {
            return null;
        }

        $same = $existing->client_id === $draft['client_id']
            && ($conversationId === null || $existing->conversation_id === $conversationId)
            && $existing->type === $draft['type']
            && $existing->body === $draft['body']
            && $existing->media_id === $draft['media_id']
            && $existing->vehicle_id === $draft['vehicle_id'];

        if (! $same) {
            throw new ApiException(ErrorCode::IdempotencyKeyReused);
        }

        return $existing;
    }

    /**
     * Checks what the draft points at before any lock: the photo is the sender's upload to this conversation and finished; the vehicle is
     * one the sender may view.
     *
     * @param  array{type: MessageType, body: string|null, media_id: string|null, vehicle_id: string|null, client_id: string}  $draft
     */
    public function assertAttachable(User $sender, string $conversationId, array $draft): void
    {
        if ($draft['type'] === MessageType::Photo) {
            $media = Media::query()->whereKey($draft['media_id'])->first();

            if (! $media instanceof Media || $media->owner_id !== $sender->id || $media->getAttribute('mediable_type') !== (new Conversation)->getMorphClass()
                || $media->getAttribute('mediable_id') !== $conversationId) {
                throw new ApiException(ErrorCode::ValidationFailed, errors: ['media_id' => [(string) __('messaging.photo_unknown')]]);
            }

            if ($media->status !== MediaStatus::Ready || ! $media->isUsablePhoto()) {
                throw new ApiException(ErrorCode::ValidationFailed, errors: ['media_id' => [(string) __('messaging.photo_not_ready')]]);
            }
        }

        if ($draft['type'] === MessageType::Vehicle) {
            $this->viewableVehicle($sender, $draft['vehicle_id'], 'vehicle_id');
        }
    }

    public function viewableVehicle(User $sender, ?string $id, string $field): Vehicle
    {
        $vehicle = $id === null ? null : Vehicle::query()->whereKey($id)->first();

        if (! $vehicle instanceof Vehicle || ! Gate::forUser($sender)->allows('view', $vehicle)) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: [$field => [(string) __('messaging.vehicle_unavailable')]]);
        }

        return $vehicle;
    }

    /**
     * Inside the caller's transaction, with $conversation, $mine and $theirs locked in that order.
     *
     * @param  array{type: MessageType, body: string|null, media_id: string|null, vehicle_id: string|null, client_id: string}  $draft
     */
    public function deliver(
        User $sender,
        User $recipient,
        Conversation $conversation,
        ConversationParticipant $mine,
        ConversationParticipant $theirs,
        array $draft,
        ?string $key,
        ?Vehicle $context = null,
    ): Message {
        $accepted = $theirs->accepted_at !== null;
        $follows = $this->eligibility->follows($recipient, $sender);
        $reason = $this->eligibility->reason($sender, $recipient, $follows, accepted: $accepted);

        if ($reason !== null) {
            throw self::cannotMessage($reason);
        }

        $now = now();
        $request = false;

        if (! $accepted && ! $follows) {
            if ($this->requestCarriesMessage($conversation, $sender, $theirs)) {
                throw new ApiException(ErrorCode::RequestPending);
            }

            $this->assertRequestAllowed($sender);
            $request = true;
        }

        $message = new Message;
        $message->forceFill([
            'id' => MessageIds::after($conversation->last_message_id),
            'conversation_id' => $conversation->id,
            'sender_id' => $sender->id,
            'client_id' => $draft['client_id'],
            'idempotency_key' => $key,
            'type' => $draft['type'],
            'body' => $draft['type'] === MessageType::Text ? $draft['body'] : null,
            'media_id' => $draft['media_id'],
            'vehicle_id' => $draft['vehicle_id'],
            'created_at' => $now,
        ]);
        $message->save();

        // M3.4 (ADM-23): a message body is flag only, never blocked; a flag files an automated report once this commits.
        if (is_string($message->body) && $message->body !== '') {
            $this->screen->flagAfterCommit($this->screen->screen(['body' => [KeywordField::MessageBody, $message->body]]), $message);
        }

        if ($draft['type'] === MessageType::Photo && ! $this->claimPhoto((string) $draft['media_id'], $conversation, $message)) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: ['media_id' => [(string) __('messaging.photo_unknown')]]);
        }

        $at = $now->format('Y-m-d H:i:s.u');

        $conversation->forceFill([
            'last_message_id' => $message->id,
            'vehicle_id' => $context->id ?? $conversation->vehicle_id,
        ])->save();
        Conversation::query()->whereKey($conversation->id)->toBase()->update(['last_message_at' => $at]);

        // Writing accepts: a reply to a request moves it to Chats, and everything before one's own message counts as read.
        ConversationParticipant::query()->whereKey($mine->id)->toBase()->update([
            'folder' => ConversationFolder::Chats->value,
            'accepted_at' => $mine->accepted_at ?? $now,
            'deleted_at' => null,
            'declined_at' => null,
            'last_read_message_id' => $message->id,
            'last_read_at' => $now,
            'unread_count' => 0,
            'last_message_at' => $at,
            'updated_at' => $now,
        ]);

        ConversationParticipant::query()->whereKey($theirs->id)->toBase()->update([
            'folder' => $accepted ? $theirs->folder->value : ($request ? ConversationFolder::Requests->value : ConversationFolder::Chats->value),
            'accepted_at' => $accepted ? $theirs->accepted_at : ($request ? null : $now),
            // A later message revives a conversation the recipient deleted for themselves; what came before stays cleared.
            'deleted_at' => null,
            'unread_count' => $theirs->unread_count + 1,
            // An unmuted archived chat comes back with a new message.
            'archived_at' => $theirs->isMuted() ? $theirs->archived_at : null,
            'last_message_at' => $at,
            'updated_at' => $now,
        ]);

        DB::afterCommit(function () use ($conversation, $message, $sender, $recipient, $request): void {
            // Counted once, after the request is stored: not for a deadlock retry, a failed photo claim or a rollback (review #15).
            if ($request) {
                RateLimiter::hit(self::requestKey($sender), config()->integer('speedclub.rate_limits.conversation_requests.minutes') * 60);
            }

            $this->signals->messageSent($conversation->id, $message->id, $sender->id, $recipient->id);
            $this->pushes->queue($recipient, $sender, $conversation->id, $message->id);
        });

        return $message;
    }

    public static function cannotMessage(CannotMessageReason $reason): ApiException
    {
        return new ApiException(ErrorCode::CannotMessage, $reason->label(), data: ['reason' => $reason->value]);
    }

    /**
     * The request already holds the sender's one message: a message of the sender after the recipient's clearing point.
     */
    public function requestCarriesMessage(Conversation $conversation, User $sender, ConversationParticipant $theirs): bool
    {
        // Declined: it stays pending for the sender, who is never told.
        if ($theirs->declined_at !== null) {
            return true;
        }

        return Message::query()
            ->where('conversation_id', $conversation->id)
            ->where('sender_id', $sender->id)
            ->when($theirs->cleared_before_message_id !== null, fn ($query) => $query->where('id', '>', $theirs->cleared_before_message_id))
            ->exists();
    }

    /**
     * 02_PRODUCT_SPEC §8: of the 20 new conversations a day, 10 may be requests. Checked here, counted after the commit (deliver()).
     */
    private function assertRequestAllowed(User $sender): void
    {
        $key = self::requestKey($sender);

        if (RateLimiter::tooManyAttempts($key, config()->integer('speedclub.rate_limits.conversation_requests.max'))) {
            throw RateLimits::tooMany('conversation_requests', ['Retry-After' => RateLimiter::availableIn($key)]);
        }
    }

    private static function requestKey(User $sender): string
    {
        return 'conversation_requests|user:'.$sender->id;
    }

    /**
     * The upload becomes the message's photo, once: a second message cannot take the same upload.
     */
    private function claimPhoto(string $mediaId, Conversation $conversation, Message $message): bool
    {
        return Media::query()
            ->whereKey($mediaId)
            ->where('mediable_type', $conversation->getMorphClass())
            ->where('mediable_id', $conversation->id)
            ->toBase()
            ->update(['mediable_type' => $message->getMorphClass(), 'mediable_id' => $message->id, 'updated_at' => now()]) === 1;
    }
}
