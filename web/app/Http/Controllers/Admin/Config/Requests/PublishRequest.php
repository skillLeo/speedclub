<?php

namespace App\Http\Controllers\Admin\Config\Requests;

use App\Enums\ConfigKey;

/** "Veröffentlichen" ⚿ (06 §1.5): the reason (10–1000, into the audit event) and the draft revision the page showed. */
class PublishRequest extends ConfigKeyRequest
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
            'reason' => ['required', 'string', 'min:10', 'max:1000'],
            'revision' => ['required', 'integer', 'min:1'],
        ];
    }
}
