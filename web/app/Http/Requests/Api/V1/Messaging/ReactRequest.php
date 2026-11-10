<?php

namespace App\Http\Requests\Api\V1\Messaging;

use App\Enums\MessageReaction;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ReactRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'key' => ['required', Rule::enum(MessageReaction::class)],
        ];
    }

    public function reaction(): MessageReaction
    {
        /** @var MessageReaction */
        return $this->enum('key', MessageReaction::class);
    }
}
