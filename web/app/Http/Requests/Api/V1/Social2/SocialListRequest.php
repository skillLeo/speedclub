<?php

namespace App\Http\Requests\Api\V1\Social2;

use App\Rules\ValidCursor;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Cursor pages of M4.11: the owner's reactions, comments, collection items.
 */
class SocialListRequest extends FormRequest
{
    private const CURSOR_COLUMNS = [
        'api.v1.reactions.vehicles.index' => ['reactions.updated_at', 'reactions.id'],
        'api.v1.reactions.build-updates.index' => ['reactions.updated_at', 'reactions.id'],
        'api.v1.comments.index' => ['comments.created_at', 'comments.id'],
        'api.v1.me.collections.items.index' => ['member_collection_items.position', 'member_collection_items.id'],
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
