<?php

namespace App\Http\Resources\V1;

use App\Enums\MessageReaction;
use App\Enums\MessageType;
use App\Http\Resources\Concerns\AnswersDelivery;
use App\Models\Media;
use App\Models\User;
use App\Services\Messaging\MessageView;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A message of MSG-02 (m2.4-contract §2). The author of a deleted account is `sender: null, sender_deleted: true` ("Gelöschtes Mitglied").
 *
 * @property MessageView $resource
 */
class MessageResource extends JsonResource
{
    use AnswersDelivery;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $view = $this->resource;
        $message = $view->message;
        $sender = $message->sender;
        $senderDeleted = ! $sender instanceof User || $sender->isDeactivated();
        $media = $message->media;

        return [
            /** ULID; sorts by time, strictly increasing within a conversation. */
            'id' => $message->id,
            /**
             * The id the sending client gave it, for your own messages only (the outbox dedupes on it); null on the other side's.
             *
             * @var string|null
             */
            'client_id' => $view->mine ? $message->client_id : null,
            'type' => $message->type,
            /** @var string|null */
            'body' => $message->type === MessageType::Text ? $message->body : null,
            'media' => $message->type === MessageType::Photo && $media instanceof Media && $media->isUsablePhoto() ? new ChatMediaResource($media) : null,
            /** Null for a vehicle the reader may not view (any more): the app shows "Fahrzeug nicht verfügbar". */
            'vehicle' => $view->vehicle === null ? null : new ChatVehicleResource($view->vehicle),
            'sender' => $senderDeleted ? null : new MemberSummaryResource($sender),
            'sender_deleted' => $senderDeleted,
            'is_mine' => $view->mine,
            /**
             * [SIG sig.msg_reactions] In the fixed order thumbs_up, heart, fire, laugh, wow, flag; only keys somebody used.
             *
             * @var list<array{key: MessageReaction, count: int, mine: bool}>
             */
            'reactions' => $view->reactions,
            'created_at' => $message->created_at->toIso8601ZuluString('millisecond'),
        ];
    }
}
