<?php

namespace App\Http\Requests\Api\V1\Moderation;

use App\Rules\ValidCursor;
use Illuminate\Foundation\Http\FormRequest;

/**
 * SET-16's two lists, newest first: GET me/reports and GET me/decisions.
 */
class OwnSafetyListRequest extends FormRequest
{
    private const CURSOR_COLUMNS = [
        'api.v1.me.reports.index' => ['reports.created_at', 'reports.id'],
        'api.v1.me.decisions.index' => ['decisions.decided_at', 'decisions.id'],
    ];

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.config()->integer('speedclub.moderation.max_page_size')],
            'cursor' => ['nullable', 'string', 'max:1000', new ValidCursor(self::CURSOR_COLUMNS[$this->route()?->getName()] ?? ['id'])],
        ];
    }

    public function pageSize(): int
    {
        return $this->filled('per_page') ? $this->integer('per_page') : config()->integer('speedclub.moderation.page_size');
    }
}
