<?php

namespace App\Http\Requests\Api\V1\Messaging;

use Illuminate\Foundation\Http\FormRequest;

class MarkReadRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** The newest message you have seen. */
            'message_id' => ['required', 'string', MessagingRules::ULID],
        ];
    }

    public function messageId(): string
    {
        return strtolower((string) $this->validated('message_id'));
    }
}
