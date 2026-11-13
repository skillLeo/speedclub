<?php

namespace App\Http\Requests\Api\V1\Garage;

use App\Rules\ValidCursor;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The cursor lists of the garage and the public routes. Order columns per route, as in their controllers.
 */
class GarageListRequest extends FormRequest
{
    private const DEFAULT_PAGE_SIZE = 30;

    protected const MAX_PAGE_SIZE = 100;

    private const CURSOR_COLUMNS = [
        'api.v1.me.vehicles.index' => ['is_main', 'sort', 'id'],
        'api.v1.me.qr-codes.index' => ['is_main', 'sort', 'id'],
        'api.v1.public.users.vehicles' => ['is_main', 'sort', 'id'],
        'api.v1.vehicles.mods.index' => ['sort', 'id'],
        'api.v1.vehicles.updates.index' => ['created_at', 'id'],
        'api.v1.public.vehicles.updates.index' => ['created_at', 'id'],
        'api.v1.public.users.updates' => ['created_at', 'id'],
    ];

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.static::MAX_PAGE_SIZE],
            'cursor' => ['nullable', 'string', 'max:1000', new ValidCursor(self::CURSOR_COLUMNS[$this->route()?->getName()] ?? ['id'])],
        ];
    }

    /**
     * "?per_page=" passes `nullable` as null, which integer() would read as 0 and so answer an empty page: it means the default.
     */
    public function pageSize(): int
    {
        return $this->filled('per_page') ? $this->integer('per_page') : self::DEFAULT_PAGE_SIZE;
    }
}
