<?php

namespace App\Http\Requests\Api\V1\Events;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class MyEventsRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** EVT-05 tabs: going (with the waitlist), interested, organised (every status), past. Default going. */
            'tab' => ['sometimes', Rule::in(['going', 'interested', 'organised', 'past'])],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:50'],
            'cursor' => ['sometimes', 'string', 'max:512'],
        ];
    }

    public function tab(): string
    {
        $tab = $this->validated('tab');

        return is_string($tab) ? $tab : 'going';
    }

    public function pageSize(): int
    {
        return (int) ($this->validated('per_page') ?? config()->integer('speedclub.events.list_page_size'));
    }
}
