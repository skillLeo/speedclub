<?php

namespace App\Http\Requests\Api\V1\Auth;

use App\Enums\SignupRef;
use App\Http\Requests\Api\V1\Auth\Concerns\NormalizesEmail;
use App\Rules\DeliverableEmail;
use App\Rules\MemberPassword;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class RegisterRequest extends FormRequest
{
    use NormalizesEmail;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'email' => ['bail', 'required', 'string', 'max:255', 'email:rfc', new DeliverableEmail],
            'password' => ['required', 'string', new MemberPassword($this->email())],
            'accepted_age_16' => ['required', 'accepted'],
            'accepted_terms' => ['required', 'accepted'],
            'accepted_privacy' => ['required', 'accepted'],
            'marketing_consent' => ['nullable', 'boolean'],
            'locale' => ['nullable', Rule::in(config()->array('speedclub.locales'))],
            // Where sign-up began, when it began on a QR scan or a public page (ADR-216): qr, public_vehicle, public_profile.
            'ref' => ['nullable', Rule::enum(SignupRef::class)],
        ];
    }
}
