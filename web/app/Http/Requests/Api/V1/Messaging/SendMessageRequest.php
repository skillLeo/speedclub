<?php

namespace App\Http\Requests\Api\V1\Messaging;

use App\Enums\MessageType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * `POST conversations/{id}/messages` (m2.4-contract §2). Text ≤ 2000 characters, trimmed, not empty; a photo by the media id of
 * `POST conversations/{id}/media`; a vehicle by its id. `client_id` (and the Idempotency-Key header) stay the same through every retry.
 */
class SendMessageRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'type' => ['required', Rule::enum(MessageType::class)],
            /** The text of a text message, at most 2000 characters. */
            'body' => ['nullable', 'required_if:type,text', 'prohibited_unless:type,text', 'string', 'max:'.config()->integer('speedclub.messaging.body_max_length')],
            'media_id' => ['nullable', 'required_if:type,photo', 'prohibited_unless:type,photo', 'string', MessagingRules::ULID],
            'vehicle_id' => ['nullable', 'required_if:type,vehicle', 'prohibited_unless:type,vehicle', 'string', MessagingRules::ULID],
            /**
             * SM11 reply (ADR-445): the id of a message of this conversation you can see. A message you deleted for yourself, one before
             * your clearing point or one that is gone is 422.
             */
            'reply_to_id' => ['nullable', 'string', MessagingRules::ULID],
            /** Your id of the message, stable across retries (a UUID). */
            'client_id' => ['required', 'string', MessagingRules::CLIENT_ID],
        ];
    }

    /**
     * @return array{type: MessageType, body: string|null, media_id: string|null, vehicle_id: string|null, client_id: string, reply_to_id: string|null}
     */
    public function draft(): array
    {
        /** @var MessageType $type */
        $type = $this->enum('type', MessageType::class);
        $body = $this->validated('body');
        $media = $this->validated('media_id');
        $vehicle = $this->validated('vehicle_id');
        $reply = $this->validated('reply_to_id');

        return [
            'type' => $type,
            'body' => is_string($body) ? trim($body) : null,
            'media_id' => is_string($media) ? strtolower($media) : null,
            'vehicle_id' => is_string($vehicle) ? strtolower($vehicle) : null,
            'client_id' => (string) $this->validated('client_id'),
            'reply_to_id' => is_string($reply) ? strtolower($reply) : null,
        ];
    }
}
