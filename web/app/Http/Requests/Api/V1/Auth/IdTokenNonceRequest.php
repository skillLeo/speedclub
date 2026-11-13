<?php

namespace App\Http\Requests\Api\V1\Auth;

use App\Enums\SocialProvider;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST auth/nonce (SEC-M46-05): which provider the nonce is for.
 */
class IdTokenNonceRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'provider' => ['required', Rule::enum(SocialProvider::class)],
        ];
    }

    public function provider(): SocialProvider
    {
        return SocialProvider::from($this->string('provider')->toString());
    }
}
