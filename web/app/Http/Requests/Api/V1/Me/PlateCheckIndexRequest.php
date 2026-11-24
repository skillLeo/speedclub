<?php

namespace App\Http\Requests\Api\V1\Me;

use App\Rules\ValidCursor;
use App\Services\Media\PlateCheck;
use Illuminate\Foundation\Http\FormRequest;

class PlateCheckIndexRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.PlateCheck::MAX_PAGE_SIZE],
            /** The `next_cursor` of the previous page. Any other cursor (of another list, or forged) is refused with 422. */
            'cursor' => ['sometimes', 'string', 'max:512', new ValidCursor(['id'])],
        ];
    }

    public function pageSize(): int
    {
        return (int) ($this->validated('per_page') ?? PlateCheck::PAGE_SIZE);
    }
}
