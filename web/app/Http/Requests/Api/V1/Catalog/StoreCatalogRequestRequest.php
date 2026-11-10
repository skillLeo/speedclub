<?php

namespace App\Http\Requests\Api\V1\Catalog;

use App\Models\Vehicle;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreCatalogRequestRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'make_text' => ['required', 'string', 'max:100'],
            'model_text' => ['nullable', 'string', 'max:100'],
            'generation_text' => ['nullable', 'string', 'max:100'],
            'vehicle_id' => [
                'nullable',
                'string',
                'ulid',
                Rule::exists(Vehicle::class, 'id')->where('owner_id', $this->user()?->getAuthIdentifier())->withoutTrashed(),
            ],
        ];
    }
}
