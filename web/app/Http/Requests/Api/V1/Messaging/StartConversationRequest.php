<?php

namespace App\Http\Requests\Api\V1\Messaging;

use App\Enums\MessageType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * `POST conversations` (m2.4-contract §2): the recipient by username, an optional vehicle context (VEH-01 "Nachricht"), and the first
 * message, a text or a vehicle card. Starting again reuses the pair's conversation.
 */
class StartConversationRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'recipient' => ['required', 'string', 'max:64'],
            /** The vehicle page the conversation starts from: it becomes the context card. */
            'vehicle_id' => ['nullable', 'string', MessagingRules::ULID],
            'message' => ['required', 'array:type,body,vehicle_id'],
            'message.type' => ['required', Rule::enum(MessageType::class)->only([MessageType::Text, MessageType::Vehicle])],
            'message.body' => ['nullable', 'required_if:message.type,text', 'prohibited_unless:message.type,text', 'string', 'max:'.config()->integer('speedclub.messaging.body_max_length')],
            'message.vehicle_id' => ['nullable', 'required_if:message.type,vehicle', 'prohibited_unless:message.type,vehicle', 'string', MessagingRules::ULID],
            'client_id' => ['required', 'string', MessagingRules::CLIENT_ID],
        ];
    }

    public function recipient(): string
    {
        return mb_strtolower(trim(ltrim((string) $this->validated('recipient'), '@')));
    }

    public function contextVehicleId(): ?string
    {
        $id = $this->validated('vehicle_id');

        return is_string($id) ? strtolower($id) : null;
    }

    /**
     * @return array{type: MessageType, body: string|null, media_id: null, vehicle_id: string|null, client_id: string}
     */
    public function draft(): array
    {
        /** @var MessageType $type */
        $type = MessageType::from((string) $this->validated('message.type'));
        $body = $this->validated('message.body');
        $vehicle = $this->validated('message.vehicle_id');

        return [
            'type' => $type,
            'body' => is_string($body) ? trim($body) : null,
            'media_id' => null,
            'vehicle_id' => is_string($vehicle) ? strtolower($vehicle) : null,
            'client_id' => (string) $this->validated('client_id'),
        ];
    }
}
