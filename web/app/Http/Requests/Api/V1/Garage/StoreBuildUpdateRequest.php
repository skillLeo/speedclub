<?php

namespace App\Http\Requests\Api\V1\Garage;

use Illuminate\Foundation\Http\FormRequest;

class StoreBuildUpdateRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'note' => ['required', 'string', 'max:500'],
        ];
    }
}
