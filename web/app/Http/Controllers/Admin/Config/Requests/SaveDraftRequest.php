<?php

namespace App\Http\Controllers\Admin\Config\Requests;

use App\Enums\ConfigKey;

/** "Entwurf speichern": the whole payload of the key (its schema validates it) and the draft revision the page loaded (null without one). */
class SaveDraftRequest extends ConfigKeyRequest
{
    protected function atom(ConfigKey $key): string
    {
        return $key->editAtom();
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'payload' => ['present', 'array'],
            'revision' => ['nullable', 'integer', 'min:1'],
        ];
    }

    /**
     * @return array<array-key, mixed>
     */
    public function payload(): array
    {
        $payload = $this->input('payload');

        return is_array($payload) ? $payload : [];
    }

    public function revision(): ?int
    {
        return $this->filled('revision') ? $this->integer('revision') : null;
    }
}
