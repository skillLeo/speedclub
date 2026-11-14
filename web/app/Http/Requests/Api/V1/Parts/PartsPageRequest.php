<?php

namespace App\Http\Requests\Api\V1\Parts;

use App\Rules\ValidCursor;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Cursor pages of the parts catalogue (brand products, builds with a product or brand).
 */
class PartsPageRequest extends FormRequest
{
    /**
     * SEC-P4-02: the order columns of each list, so a forged cursor is a 422, never a 500. Brand tiles are one page (no cursor at all).
     */
    private const CURSOR_COLUMNS = [
        'api.v1.brands.index' => [],
        'api.v1.brands.products' => self::RANKED_PRODUCTS,
        'api.v1.brands.builds' => ['sample', 'sort_at', 'id'],
        'api.v1.products.builds' => ['sample', 'sort_at', 'id'],
    ];

    /** PartBuilds::ranked. */
    protected const RANKED_PRODUCTS = ['products.real_builds', 'products.visible_builds', 'products.name', 'products.id'];

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.config()->integer('speedclub.parts.max_page_size')],
            /** The `next_cursor` of the previous page. Any other cursor (of another list, or forged) is refused with 422. */
            'cursor' => ['sometimes', 'string', 'max:512', new ValidCursor($this->cursorColumns())],
        ];
    }

    public function pageSize(): int
    {
        return (int) ($this->validated('per_page') ?? config()->integer('speedclub.parts.page_size'));
    }

    /**
     * @return list<string>
     */
    protected function cursorColumns(): array
    {
        return self::CURSOR_COLUMNS[$this->route()?->getName()] ?? ['id'];
    }
}
