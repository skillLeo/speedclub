<?php

namespace App\Http\Requests\Api\V1\Me;

use App\Http\Requests\Api\V1\Auth\Concerns\NormalizesEmail;
use App\Http\Requests\Api\V1\Me\Concerns\ProvesPassword;
use App\Rules\DeliverableEmail;
use Illuminate\Foundation\Http\FormRequest;

class ChangeEmailRequest extends FormRequest
{
    use NormalizesEmail, ProvesPassword;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // The new address, normalised like every address (EmailAddress). It must reach a mailbox the first time (DeliverableEmail).
            'email' => ['bail', 'required', 'string', 'max:255', 'email:rfc', new DeliverableEmail],
            // The current password.
            'password' => $this->passwordRule(),
            // With two-factor on: a current code from the authenticator app or a recovery code (SEC-P2-07).
            'code' => ['nullable', 'string', 'max:32'],
        ];
    }
}
