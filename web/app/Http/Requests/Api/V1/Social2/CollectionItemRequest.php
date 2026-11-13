<?php

namespace App\Http\Requests\Api\V1\Social2;

use App\Enums\CollectionItemType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class CollectionItemRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'type' => ['required', Rule::enum(CollectionItemType::class)],
            'id' => ['required', 'string', 'size:26'],
        ];
    }
}
