<?php

namespace App\Http\Requests\Api\V1\Crews;

use App\Rules\ValidCursor;
use App\Services\Crews\CrewListing;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Cursor pages of the crew lists (members, requests, invitations).
 */
class CrewPageRequest extends FormRequest
{
    /**
     * The order columns of each list, so a forged cursor is a 422, never a 500.
     */
    private const CURSOR_COLUMNS = [
        'api.v1.crews.members.index' => CrewListing::CURSOR_MEMBERS,
        'api.v1.crews.requests.index' => ['created_at', 'id'],
        'api.v1.crews.invites.index' => ['created_at', 'id'],
        'api.v1.me.crew-invites.index' => ['created_at', 'id'],
        'api.v1.me.crew-requests.index' => ['created_at', 'id'],
    ];

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.config()->integer('speedclub.crews.max_page_size')],
            /** The `next_cursor` of the previous page. Any other cursor (of another list, or forged) is refused with 422. */
            'cursor' => ['sometimes', 'string', 'max:512', new ValidCursor(self::CURSOR_COLUMNS[$this->route()?->getName()] ?? ['id'])],
        ];
    }

    public function pageSize(): int
    {
        return (int) ($this->validated('per_page') ?? config()->integer('speedclub.crews.page_size'));
    }
}
