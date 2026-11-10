<?php

namespace App\Http\Requests\Api\V1\Social;

use App\Rules\ValidCursor;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The member's own lists of M2.1, newest first: blocked accounts (SET-08) and saved builds (PROF-05).
 */
class OwnListRequest extends FormRequest
{
    private const CURSOR_COLUMNS = [
        'api.v1.me.blocks.index' => ['blocks.created_at', 'blocks.id'],
        'api.v1.me.saved.index' => ['saves.created_at', 'saves.id'],
    ];

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.config()->integer('speedclub.social.max_page_size')],
            'cursor' => ['nullable', 'string', 'max:1000', new ValidCursor(self::CURSOR_COLUMNS[$this->route()?->getName()] ?? ['id'])],
        ];
    }

    public function pageSize(): int
    {
        return $this->filled('per_page') ? $this->integer('per_page') : config()->integer('speedclub.social.page_size');
    }
}
