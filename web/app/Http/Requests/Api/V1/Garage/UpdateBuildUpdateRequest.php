<?php

namespace App\Http\Requests\Api\V1\Garage;

use Illuminate\Foundation\Http\FormRequest;

class UpdateBuildUpdateRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'hidden' => ['required', 'boolean'],
        ];
    }
}
