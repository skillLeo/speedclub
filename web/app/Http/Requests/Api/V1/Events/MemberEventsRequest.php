<?php

namespace App\Http\Requests\Api\V1\Events;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class MemberEventsRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** upcoming (default, by start) or past (newest first). */
            'when' => ['sometimes', Rule::in(['upcoming', 'past'])],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:50'],
            'cursor' => ['sometimes', 'string', 'max:512'],
        ];
    }

    public function past(): bool
    {
        return $this->validated('when') === 'past';
    }

    public function pageSize(): int
    {
        return (int) ($this->validated('per_page') ?? config()->integer('speedclub.events.list_page_size'));
    }
}
