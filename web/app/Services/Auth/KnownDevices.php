<?php

namespace App\Services\Auth;

use App\Models\KnownDevice;
use App\Models\User;
use Illuminate\Http\Request;

final class KnownDevices
{
    /**
     * Notes this sign-in. True when the account has signed in elsewhere before and never from here; the very first device
     * of an account is not news to anybody.
     */
    public function remember(User $user, string $fingerprint): bool
    {
        $hadDevices = $user->knownDevices()->exists();

        $device = KnownDevice::query()->firstOrCreate(
            ['user_id' => $user->getKey(), 'fingerprint' => $fingerprint],
            ['last_seen_at' => now()],
        );

        if (! $device->wasRecentlyCreated) {
            $device->forceFill(['last_seen_at' => now()])->save();
        }

        return $hadDevices && $device->wasRecentlyCreated;
    }

    /**
     * A browser has no device name. Version numbers go, or every browser update would count as a new device.
     */
    public function browserFingerprint(Request $request): string
    {
        return self::userAgentFingerprint((string) $request->userAgent());
    }

    /**
     * The browser fingerprint of a user agent, for a seeder that knows the device in advance (DemoSeeder, speedclub.qa.user_agent).
     */
    public static function userAgentFingerprint(string $userAgent): string
    {
        return hash('sha256', 'browser|'.preg_replace('/[\d._]+/', '', $userAgent));
    }
}
