<?php

namespace App\Http\Requests\Api\V1\Social2;

use Illuminate\Foundation\Http\FormRequest;

class MentionSuggestRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['q' => ['present', 'nullable', 'string', 'max:30']];
    }
}
