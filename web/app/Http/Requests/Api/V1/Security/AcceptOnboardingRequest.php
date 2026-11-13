<?php

namespace App\Http\Requests\Api\V1\Security;

use Illuminate\Foundation\Http\FormRequest;

/**
 * AUTH-09b: both versions as app-config lists them, and the age line ticked.
 */
class AcceptOnboardingRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'terms_version' => ['required', 'string', 'max:32'],
            'privacy_version' => ['required', 'string', 'max:32'],
            // "Ich bin mindestens 16 Jahre alt." Must be true.
            'age_confirmed' => ['required', 'accepted'],
        ];
    }
}
