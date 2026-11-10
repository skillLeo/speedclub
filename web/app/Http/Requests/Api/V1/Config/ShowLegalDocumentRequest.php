<?php

namespace App\Http\Requests\Api\V1\Config;

use Illuminate\Foundation\Http\FormRequest;

class ShowLegalDocumentRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'version' => ['nullable', 'string', 'max:32'],
        ];
    }
}
