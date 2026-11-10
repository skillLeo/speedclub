<?php

namespace App\Http\Requests\Api\V1\Messaging;

use Illuminate\Foundation\Http\FormRequest;

/**
 * GET chat-media/{media}/{width}: the signed URL of a chat photo. The signature covers `viewer`.
 */
class ChatMediaRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'viewer' => ['required', 'string', MessagingRules::ULID],
        ];
    }

    public function viewerId(): string
    {
        return strtolower((string) $this->validated('viewer'));
    }
}
