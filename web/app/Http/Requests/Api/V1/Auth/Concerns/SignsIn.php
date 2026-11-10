<?php

namespace App\Http\Requests\Api\V1\Auth\Concerns;

use App\Enums\DevicePlatform;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Support\Auth\DeviceInfo;
use Illuminate\Validation\Rule;

/**
 * device_name selects a token for that device; without it the sign-in needs the SPA's session (05_ARCHITECTURE §7). device_id,
 * the app's per-install id, tells two devices of the same model apart; it means nothing without device_name.
 */
trait SignsIn
{
    /**
     * @return array<string, mixed>
     */
    protected function deviceRules(): array
    {
        return [
            'device_name' => ['nullable', 'string', 'max:120'],
            'platform' => ['nullable', Rule::enum(DevicePlatform::class)],
            'app_version' => ['nullable', 'string', 'max:32'],
            // The app's per-install id (a UUID kept in secure storage). Tells two devices of the same model apart; ignored without device_name.
            'device_id' => ['nullable', 'string', 'regex:'.DeviceInfo::ID_PATTERN],
        ];
    }

    public function device(): ?DeviceInfo
    {
        $name = $this->validated('device_name');

        if (! is_string($name) || $name === '') {
            return null;
        }

        $version = $this->validated('app_version');
        $id = $this->validated('device_id');

        return new DeviceInfo(
            $name,
            $this->enum('platform', DevicePlatform::class),
            is_string($version) ? $version : null,
            is_string($id) && $id !== '' ? $id : null,
        );
    }

    /**
     * ADR-124: without GET /sanctum/csrf-cookie first there is no session to sign in on. Answered here, before a password
     * attempt or a code is spent.
     */
    protected function passedValidation(): void
    {
        if ($this->device() === null && ! $this->hasSession()) {
            throw new ApiException(ErrorCode::SessionExpired);
        }
    }
}
