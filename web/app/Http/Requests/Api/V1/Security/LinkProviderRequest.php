<?php

namespace App\Http\Requests\Api\V1\Security;

use App\Enums\SocialProvider;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST me/providers: a fresh ID token of the provider and the raw nonce from POST auth/nonce it was made with (SEC-M46-05).
 */
class LinkProviderRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'provider' => ['required', Rule::enum(SocialProvider::class)],
            'id_token' => ['required', 'string', 'max:8192'],
            'raw_nonce' => ['required', 'string', 'min:16', 'max:256'],
            'authorization_code' => ['nullable', 'string', 'max:1024'],
        ];
    }

    public function provider(): SocialProvider
    {
        return SocialProvider::from($this->string('provider')->toString());
    }

    public function optional(string $key): ?string
    {
        $value = $this->validated($key);

        return is_string($value) && $value !== '' ? $value : null;
    }
}
