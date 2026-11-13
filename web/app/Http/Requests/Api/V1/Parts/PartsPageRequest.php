<?php

namespace App\Http\Requests\Api\V1\Parts;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Cursor pages of the parts catalogue (brand products, builds with a product or brand).
 */
class PartsPageRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.config()->integer('speedclub.parts.max_page_size')],
            'cursor' => ['sometimes', 'string', 'max:512'],
        ];
    }

    public function pageSize(): int
    {
        return (int) ($this->validated('per_page') ?? config()->integer('speedclub.parts.page_size'));
    }
}
