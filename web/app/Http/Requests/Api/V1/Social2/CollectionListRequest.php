<?php

namespace App\Http\Requests\Api\V1\Social2;

use App\Enums\CollectionItemType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * COL-01, and the save sheet: with contains_type and contains_id every collection says whether it holds that item.
 */
class CollectionListRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'contains_type' => ['nullable', 'required_with:contains_id', Rule::enum(CollectionItemType::class)],
            'contains_id' => ['nullable', 'required_with:contains_type', 'string', 'size:26'],
        ];
    }
}
