<?php

namespace App\Http\Requests\Api\V1\Ai;

use Illuminate\Foundation\Http\FormRequest;

class InterpretSearchRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** The search as typed, e.g. "schwarze M4 mit KW V3 und 19 Zoll". */
            'q' => ['required', 'string', 'min:2', 'max:200'],
        ];
    }
}
