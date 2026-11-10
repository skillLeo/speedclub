<?php

namespace App\Http\Requests\Api\V1\Moderation;

use Illuminate\Foundation\Http\FormRequest;

/**
 * POST decisions/{id}/appeal: why the decision is wrong, in the member's words (at most 2000 characters).
 */
class StoreAppealRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'text' => ['required', 'string', 'max:'.config()->integer('speedclub.moderation.appeal_max_length')],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'text.required' => (string) __('safety.validation.appeal_required'),
            'text.max' => (string) __('safety.validation.appeal_max'),
        ];
    }

    public function text(): string
    {
        return trim($this->string('text')->toString());
    }
}
