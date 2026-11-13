<?php

namespace App\Http\Requests\Api\V1\Security;

use Illuminate\Foundation\Http\FormRequest;

/**
 * POST me/passkeys: the ceremony_id of POST me/passkeys/options and the PublicKeyCredential of navigator.credentials.create() as JSON
 * (id, rawId, type, response.clientDataJSON, response.attestationObject, response.transports; base64url). name is optional; without it
 * the provider's name ("iCloud-Schlüsselbund") or "Passkey".
 */
class StorePasskeyRequest extends FormRequest
{
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
            'name' => ['nullable', 'string', 'max:'.config()->integer('speedclub.passkeys.name_max_length')],
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
