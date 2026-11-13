<?php

namespace App\Http\Requests\Api\V1\Security;

use App\Enums\ReauthMethod;
use App\Http\Requests\Api\V1\Auth\StartEmailCodeRequest;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST me/reauth. passkey: ceremony_id + credential; email_code: attempt_id + code; password: password. two_factor_code with two-factor
 * on for email_code and password.
 */
class ReauthRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'method' => ['required', Rule::enum(ReauthMethod::class)],
            'password' => ['required_if:method,password', 'nullable', 'string', 'max:'.config()->integer('speedclub.passwords.max_length')],
            'attempt_id' => ['required_if:method,email_code', 'nullable', 'string', 'regex:'.StartEmailCodeRequest::ATTEMPT_PATTERN],
            'code' => ['required_if:method,email_code', 'nullable', 'string', 'digits:'.config()->integer('speedclub.email_code.code_length')],
            'ceremony_id' => ['required_if:method,passkey', 'nullable', 'string', 'ulid'],
            'credential' => ['required_if:method,passkey', 'nullable', 'array'],
            'two_factor_code' => ['nullable', 'string', 'max:32'],
        ];
    }

    public function reauthMethod(): ReauthMethod
    {
        return ReauthMethod::from($this->string('method')->toString());
    }

    /**
     * @return array{password?: string|null, attempt_id?: string|null, code?: string|null, ceremony_id?: string|null, credential?: array<string, mixed>|null, two_factor_code?: string|null}
     */
    public function proof(): array
    {
        /** @var array{password?: string|null, attempt_id?: string|null, code?: string|null, ceremony_id?: string|null, credential?: array<string, mixed>|null, two_factor_code?: string|null} $proof */
        $proof = $this->safe()->only(['password', 'attempt_id', 'code', 'ceremony_id', 'credential', 'two_factor_code']);

        return $proof;
    }
}
