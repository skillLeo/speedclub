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
        if ($this->isPasswordless()) {
            return [
                'email' => ['bail', 'required', 'string', 'max:255', 'email:rfc'],
                // M4.6 (09 §8.1): the attempt of POST auth/email/start. With it this is the passwordless sign-in.
                'attempt_id' => ['required', 'string', 'regex:'.StartEmailCodeRequest::ATTEMPT_PATTERN],
                // The 6-digit code from the mail, or the token of its "Anmelden" link (same device only).
                'code' => ['required_without:magic_token', 'nullable', 'string', 'digits:'.config()->integer('speedclub.email_code.code_length')],
                'magic_token' => ['required_without:code', 'nullable', 'string', 'max:64'],
                // The language of a new account (de, en); the request's language otherwise.
                'locale' => ['nullable', 'string', Rule::in(config()->array('speedclub.locales'))],
                ...$this->deviceRules(),
            ];
        }

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
     * M4.6: a request with attempt_id is the passwordless e-mail code sign-in (09 §8.1); without it the registration's verify.
     */
    public function isPasswordless(): bool
    {
        return $this->has('attempt_id');
    }

    public function optionalString(string $key): ?string
    {
        $value = $this->validated($key);

        return is_string($value) && $value !== '' ? $value : null;
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
