<?php

namespace App\Http\Controllers\Admin\Config\Requests;

use App\Enums\ConfigKey;

/** "Entwurf verwerfen": the own draft without a reason; another staff member's only with the publish atom and a reason (engine). */
class DiscardDraftRequest extends ConfigKeyRequest
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
        return ['reason' => ['nullable', 'string', 'min:10', 'max:1000']];
    }

    public function optionalReason(): ?string
    {
        $reason = $this->reason();

        return $reason === '' ? null : $reason;
    }
}
