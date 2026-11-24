<?php

namespace App\Http\Controllers\Admin\Config\Requests;

use App\Enums\ConfigKey;

/** "Entwurf übernehmen" ⚿ (M5.1): the key's publish atom, a reason (10–1000, into the audit event) and the draft revision the page showed. */
class TakeOverDraftRequest extends ConfigKeyRequest
{
    protected function atom(ConfigKey $key): string
    {
        return $key->publishAtom();
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'reason' => ['nullable', 'string', 'max:1000'],
            'revision' => ['required', 'integer', 'min:1'],
        ];
    }
}
