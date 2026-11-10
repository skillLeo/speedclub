<?php

namespace App\Http\Controllers\Admin\Config\Requests;

use App\Enums\ConfigKey;

/** ADM-35 "Zurückrollen" ⚿: the version to publish again as the newest one, with a reason. */
class RollbackRequest extends ConfigKeyRequest
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
        return ['reason' => ['required', 'string', 'min:10', 'max:1000']];
    }

    public function version(): int
    {
        $version = $this->route('version');

        return is_numeric($version) ? (int) $version : 0;
    }
}
