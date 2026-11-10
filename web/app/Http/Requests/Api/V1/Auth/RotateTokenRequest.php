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
        ];
    }

    public function deviceId(): ?string
    {
        $id = $this->validated('device_id');

        return is_string($id) && $id !== '' ? $id : null;
    }
}
