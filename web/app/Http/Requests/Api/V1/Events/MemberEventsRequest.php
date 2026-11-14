<?php

namespace App\Http\Requests\Api\V1\Events;

use App\Rules\ValidCursor;
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
            /** The `next_cursor` of the previous page. Any other cursor (of another list, or forged) is refused with 422. */
            'cursor' => ['sometimes', 'string', 'max:512', new ValidCursor(['events.starts_at', 'events.id'])],
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
