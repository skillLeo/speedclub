<?php

namespace App\Actions\Notifications;

use App\Enums\DevicePlatform;
use App\Models\PushToken;
use App\Models\User;
use App\Services\Auth\DeviceInstalls;
use Illuminate\Support\Facades\DB;

/**
 * One push token per app install (device_id). Idempotent: the same call twice leaves one row. A new token of the install replaces the
 * old one, and an install or token that last belonged to another member now belongs to this one: whoever signed in last on a phone gets
 * its pushes.
 */
class RegisterPushToken
{
    public function handle(User $user, string $token, DevicePlatform $platform, string $deviceId): void
    {
        // SEC-M47-03: the install id is kept keyed to the member, and without the member only for the one-row-per-install rule.
        $installKey = DeviceInstalls::installKey($deviceId);
        $deviceId = DeviceInstalls::key((string) $user->getKey(), $deviceId);

        DB::transaction(function () use ($user, $token, $platform, $deviceId, $installKey): void {
            PushToken::query()
                ->where(fn ($query) => $query->where('install_key', $installKey)->orWhere('device_id', $deviceId)->orWhere('token', $token))
                ->where(fn ($query) => $query->where('user_id', '!=', $user->id)->orWhere('token', '!=', $token))
                ->delete();

            $row = PushToken::query()->where('user_id', $user->id)->where('token', $token)->lockForUpdate()->first() ?? new PushToken;
            $row->forceFill([
                'user_id' => $user->id,
                'token' => $token,
                'platform' => $platform,
                'device_id' => $deviceId,
                'install_key' => $installKey,
                'last_used_at' => now(),
            ])->save();
        });
    }
}
