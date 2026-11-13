<?php

namespace App\Actions\Notifications;

use App\Models\User;
use App\Services\Auth\DeviceInstalls;

/**
 * The app unregisters at sign-out or when the member turns push off in the system settings. Only this member's token of the install
 * goes; an unknown install is no error.
 */
class RemovePushToken
{
    public function handle(User $user, string $deviceId): void
    {
        $user->pushTokens()->where('device_id', DeviceInstalls::key((string) $user->getKey(), $deviceId))->delete();
    }
}
