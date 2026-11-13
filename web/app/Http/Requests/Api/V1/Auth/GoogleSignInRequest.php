<?php

namespace App\Http\Requests\Api\V1\Auth;

use App\Http\Requests\Api\V1\Auth\Concerns\SignsIn;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST auth/google (09 §8.1): the ID token of the Google SDK or Google Identity Services; nonce when the client passed one to Google.
 */
class GoogleSignInRequest extends FormRequest
{
    use SignsIn;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'id_token' => ['required', 'string', 'max:8192'],
            // SEC-M46-05: the raw nonce from POST auth/nonce that was given to the Google SDK; single use.
            'nonce' => ['required', 'string', 'min:16', 'max:256'],
            'locale' => ['nullable', 'string', Rule::in(config()->array('speedclub.locales'))],
            ...$this->deviceRules(),
        ];
    }

    /**
     * @return array{id_token: string, raw_nonce: string|null, locale: string|null}
     */
    public function signInInput(): array
    {
        $nonce = $this->validated('nonce');
        $locale = $this->validated('locale');

        return [
            'id_token' => $this->string('id_token')->toString(),
            'raw_nonce' => is_string($nonce) && $nonce !== '' ? $nonce : null,
            'locale' => is_string($locale) && $locale !== '' ? $locale : null,
        ];
    }
}
