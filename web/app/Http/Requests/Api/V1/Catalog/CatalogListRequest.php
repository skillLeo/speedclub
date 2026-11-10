<?php

namespace App\Http\Requests\Api\V1\Catalog;

use App\Rules\ValidCursor;
use Illuminate\Foundation\Http\FormRequest;

class CatalogListRequest extends FormRequest
{
    /**
     * Order columns per route, as in CatalogController.
     */
    private const CURSOR_COLUMNS = [
        'api.v1.catalog.makes' => ['is_popular', 'sort', 'name', 'id'],
        'api.v1.catalog.models' => ['name', 'id'],
        'api.v1.catalog.generations' => ['id'],
        'api.v1.catalog.brands' => ['name', 'id'],
        'api.v1.catalog.mod-categories' => ['sort', 'id'],
    ];

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.config()->integer('speedclub.catalog.max_page_size')],
            'cursor' => ['nullable', 'string', 'max:1000', new ValidCursor(self::CURSOR_COLUMNS[$this->route()?->getName()] ?? ['id'])],
        ];
    }

    /**
     * "?per_page=" passes `nullable` as null, which integer() would read as 0 and so answer an empty page: it means the default.
     */
    public function pageSize(): int
    {
        return $this->filled('per_page') ? $this->integer('per_page') : config()->integer('speedclub.catalog.default_page_size');
    }
}
