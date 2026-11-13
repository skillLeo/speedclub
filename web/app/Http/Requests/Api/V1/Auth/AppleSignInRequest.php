<?php

namespace App\Http\Requests\Api\V1\Auth;

use App\Http\Requests\Api\V1\Auth\Concerns\SignsIn;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST auth/apple (09 §8.1). raw_nonce comes from POST auth/nonce; the app hashed it (SHA-256) for Apple. full_name arrives from Apple on the first
 * authorisation only and is stored at once; the address is always taken from the verified token, never from the body.
 */
class AppleSignInRequest extends FormRequest
{
    use SignsIn;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'identity_token' => ['required', 'string', 'max:8192'],
            'authorization_code' => ['nullable', 'string', 'max:1024'],
            'raw_nonce' => ['required', 'string', 'min:16', 'max:256'],
            'full_name' => ['nullable', 'string', 'max:120'],
            // Ignored: Apple's address is read from the verified token. Accepted so the client may send what the SDK returned.
            'email' => ['nullable', 'string', 'max:255'],
            'locale' => ['nullable', 'string', Rule::in(config()->array('speedclub.locales'))],
            ...$this->deviceRules(),
        ];
    }

    /**
     * @return array{id_token: string, raw_nonce: string|null, authorization_code: string|null, full_name: string|null, locale: string|null}
     */
    public function signInInput(): array
    {
        return [
            'id_token' => $this->string('identity_token')->toString(),
            'raw_nonce' => $this->stringOrNull('raw_nonce'),
            'authorization_code' => $this->stringOrNull('authorization_code'),
            'full_name' => $this->stringOrNull('full_name'),
            'locale' => $this->stringOrNull('locale'),
        ];
    }

    private function stringOrNull(string $key): ?string
    {
        $value = $this->validated($key);

        return is_string($value) && $value !== '' ? $value : null;
    }
}
