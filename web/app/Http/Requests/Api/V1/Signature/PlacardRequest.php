<?php

namespace App\Http\Requests\Api\V1\Signature;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class PlacardRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** `a5` (default) or `a4`, portrait. */
            'size' => ['sometimes', 'string', Rule::in(['a5', 'a4'])],
        ];
    }

    public function paperSize(): string
    {
        return $this->string('size', 'a5')->toString();
    }
}
