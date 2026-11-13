<?php

namespace App\Http\Requests\Api\V1\Auth;

use App\Http\Requests\Api\V1\Auth\Concerns\SignsIn;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST auth/passkeys/verify: the ceremony_id of POST auth/passkeys/options and the PublicKeyCredential as JSON (id, rawId, type,
 * response.clientDataJSON, response.authenticatorData, response.signature, response.userHandle; base64url).
 */
class PasskeySignInRequest extends FormRequest
{
    use SignsIn;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'ceremony_id' => ['required', 'string', 'ulid'],
            'credential' => ['required', 'array'],
            'credential.id' => ['required', 'string', 'max:1024'],
            'credential.rawId' => ['required', 'string', 'max:1024'],
            'credential.type' => ['required', 'string', 'in:public-key'],
            'credential.response' => ['required', 'array'],
            ...$this->deviceRules(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function credential(): array
    {
        /** @var array<string, mixed> $credential */
        $credential = $this->input('credential');

        return $credential;
    }
}
