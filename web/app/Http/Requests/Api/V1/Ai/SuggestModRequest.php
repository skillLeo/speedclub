<?php

namespace App\Http\Requests\Api\V1\Ai;

use Illuminate\Foundation\Http\FormRequest;

class SuggestModRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** The category the member already chose (GAR-10); without it the suggestion picks one. */
            'category_key' => ['sometimes', 'nullable', 'string', 'max:40'],
            /** The pasted text, e.g. an invoice line. */
            'text' => ['required', 'string', 'min:3', 'max:500'],
        ];
    }
}
