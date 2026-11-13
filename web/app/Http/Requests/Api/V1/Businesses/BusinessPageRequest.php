<?php

namespace App\Http\Requests\Api\V1\Businesses;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Cursor pages of business lists (portfolio, tag requests, team).
 */
class BusinessPageRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.config()->integer('speedclub.businesses.max_page_size')],
            'cursor' => ['sometimes', 'string', 'max:512'],
        ];
    }

    public function pageSize(): int
    {
        return (int) ($this->validated('per_page') ?? config()->integer('speedclub.businesses.page_size'));
    }
}
