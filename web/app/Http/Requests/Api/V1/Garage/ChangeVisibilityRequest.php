<?php

namespace App\Http\Requests\Api\V1\Garage;

use App\Enums\Visibility;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ChangeVisibilityRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'visibility' => ['required', Rule::enum(Visibility::class)],
        ];
    }
}
