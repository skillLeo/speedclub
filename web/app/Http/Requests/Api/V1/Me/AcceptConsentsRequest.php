<?php

namespace App\Http\Requests\Api\V1\Me;

use Illuminate\Foundation\Http\FormRequest;

class AcceptConsentsRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // The version shown in the sheet (GET me/consents `required[].version`). At least one of the two.
            'terms_version' => ['required_without:privacy_version', 'nullable', 'string', 'max:32'],
            'privacy_version' => ['required_without:terms_version', 'nullable', 'string', 'max:32'],
        ];
    }
}
