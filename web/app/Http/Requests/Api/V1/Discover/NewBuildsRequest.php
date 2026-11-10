<?php

namespace App\Http\Requests\Api\V1\Discover;

use App\Rules\ValidCursor;
use Illuminate\Foundation\Http\FormRequest;

/**
 * "Neue Builds" of HOME-01: newest first, cursor pages.
 */
class NewBuildsRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.config()->integer('speedclub.home.new_builds_max_page_size')],
            'cursor' => ['nullable', 'string', 'max:1000', new ValidCursor(['sort_at', 'id'])],
        ];
    }

    /**
     * "?per_page=" passes `nullable` as null, which integer() would read as 0 and so answer an empty page: it means the default.
     */
    public function pageSize(): int
    {
        return $this->filled('per_page') ? $this->integer('per_page') : config()->integer('speedclub.home.new_builds_page_size');
    }
}
