<?php

namespace App\Http\Controllers\Admin\Config\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/**
 * ADM-36 change a flag ⚿ (`flags.manage`, reason): only the fields that change (UpdateFeatureFlag validates the state they lead to).
 */
class FlagRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'flags.manage';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['changes' => ['required', 'array']];
    }

    /**
     * @return array<string, mixed>
     */
    public function changes(): array
    {
        $changes = $this->input('changes');

        return is_array($changes) ? $changes : [];
    }
}
