<?php

namespace App\Http\Requests\Api\V1\Events;

use App\Rules\ValidCursor;
use Illuminate\Foundation\Http\FormRequest;

/**
 * M5.6 GET me/checkins and GET public/users/{username}/checkins: newest check-in first.
 */
class CheckinListRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.$this->maxPage()],
            /** The `next_cursor` of the previous page. */
            'cursor' => ['sometimes', 'string', 'max:512', new ValidCursor(['event_checkins.checked_in_at', 'event_checkins.id'])],
        ];
    }

    public function pageSize(): int
    {
        return (int) ($this->validated('per_page') ?? min(20, $this->maxPage()));
    }

    private function maxPage(): int
    {
        return $this->routeIs('*public.*')
            ? config()->integer('speedclub.events.public_checkins_page_max')
            : config()->integer('speedclub.events.checkins_page_max');
    }
}
