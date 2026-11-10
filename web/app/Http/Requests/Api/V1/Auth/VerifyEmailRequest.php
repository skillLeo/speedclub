<?php

namespace App\Http\Requests\Api\V1\Auth;

use App\Http\Requests\Api\V1\Auth\Concerns\NormalizesEmail;
use App\Http\Requests\Api\V1\Auth\Concerns\SignsIn;
use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class VerifyEmailRequest extends FormRequest
{
    use NormalizesEmail, SignsIn;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'email' => ['bail', 'required', 'string', 'max:255', 'email:rfc'],
            'code' => ['required', 'string', 'digits:'.config()->integer('speedclub.verification.code_length')],
            // The password of the registration. Not needed when the request is already signed in as this account.
            'password' => [
                Rule::requiredIf(fn (): bool => $this->signedInMember()?->email !== $this->email()),
                'nullable',
                'string',
                'max:'.config()->integer('speedclub.passwords.max_length'),
            ],
            ...$this->deviceRules(),
        ];
    }

    /**
     * Whoever the token or session on this otherwise anonymous route belongs to.
     */
    public function signedInMember(): ?User
    {
        $user = $this->user('sanctum');

        return $user instanceof User ? $user : null;
    }

    public function password(): ?string
    {
        $password = $this->validated('password');

        return is_string($password) ? $password : null;
    }
}
