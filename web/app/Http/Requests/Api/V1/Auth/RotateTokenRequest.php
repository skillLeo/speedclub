<?php

namespace App\Http\Requests\Api\V1\Auth;

use App\Support\Auth\DeviceInfo;
use Illuminate\Foundation\Http\FormRequest;

class RotateTokenRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // The app's per-install id, as sent at sign-in. Taken only by a token that has none yet (an older app build's).
            'device_id' => ['nullable', 'string', 'regex:'.DeviceInfo::ID_PATTERN],
            // M4.7 (09 §8.4): the app and system version now, so SET-06 shows them after an update.
            'app_version' => ['nullable', 'string', 'max:32'],
            'os_version' => ['nullable', 'string', 'max:40'],
        ];
    }

    public function appVersion(): ?string
    {
        $value = $this->validated('app_version');

        return is_string($value) && $value !== '' ? $value : null;
    }

    public function osVersion(): ?string
    {
        $value = $this->validated('os_version');

        return is_string($value) && $value !== '' ? $value : null;
    }

    public function deviceId(): ?string
    {
        $id = $this->validated('device_id');

        return is_string($id) && $id !== '' ? $id : null;
    }
}
