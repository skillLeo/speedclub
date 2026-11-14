<?php

namespace App\Http\Requests\Api\V1\Businesses;

use App\Rules\ValidCursor;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Cursor pages of business lists (portfolio, tag requests, team).
 */
class BusinessPageRequest extends FormRequest
{
    /**
     * SEC-P4-02: the order columns of each list, so a forged cursor is a 422, never a 500.
     */
    private const CURSOR_COLUMNS = [
        'api.v1.businesses.portfolio' => ['sample', 'sort_at', 'id'],
        'api.v1.me.business-invites.index' => ['created_at', 'id'],
        'api.v1.me.business.tags.index' => ['created_at', 'id'],
        'api.v1.me.mod-tags.index' => ['created_at', 'id'],
    ];

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.config()->integer('speedclub.businesses.max_page_size')],
            /** The `next_cursor` of the previous page. Any other cursor (of another list, or forged) is refused with 422. */
            'cursor' => ['sometimes', 'string', 'max:512', new ValidCursor(self::CURSOR_COLUMNS[$this->route()?->getName()] ?? ['id'])],
        ];
    }

    public function pageSize(): int
    {
        return (int) ($this->validated('per_page') ?? config()->integer('speedclub.businesses.page_size'));
    }
}
