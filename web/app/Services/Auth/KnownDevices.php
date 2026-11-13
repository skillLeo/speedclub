<?php

namespace App\Services\Auth;

use App\Models\KnownDevice;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Str;

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
     * SEC-M47-02: a browser is a random id in a long-lived first-party cookie (speedclub.known_devices.browser_cookie), the browser's own
     * "install id" (09 §8.4). A browser without it is new: another browser version, or a stranger's browser with the same user agent, can
     * no longer pass for a known one. Keyed with the member, so the stored value joins no two accounts of one browser.
     *
     * The E2E harness (speedclub.qa.user_agent, never set in production) keeps its seeded user-agent fingerprint (DemoSeeder), so its
     * sign-ins write no login alert into the seeded HOME-02 history.
     */
    public function browserFingerprint(User $user, Request $request): string
    {
        $qa = config('speedclub.qa.user_agent');

        if (is_string($qa) && $qa !== '' && ! app()->environment('production') && $request->userAgent() === $qa) {
            return self::userAgentFingerprint($qa);
        }

        $name = config()->string('speedclub.known_devices.browser_cookie');
        $id = $request->cookie($name);

        if (! is_string($id) || preg_match('/\A[A-Za-z0-9]{40}\z/', $id) !== 1) {
            $id = Str::random(40);
            Cookie::queue(Cookie::make($name, $id, config()->integer('speedclub.known_devices.browser_cookie_days') * 1440, '/', null, (bool) (config('session.secure') ?? $request->isSecure()), true, false, 'lax'));
        }

        return hash_hmac('sha256', 'browser-id|'.$user->getKey().'|'.$id, config()->string('app.key'));
    }

    /**
     * The fingerprint of a user agent: the E2E harness's seeded device (DemoSeeder, speedclub.qa.user_agent) and the admin's device labels
     * of sign-ins before SEC-M47-02.
     */
    public static function userAgentFingerprint(string $userAgent): string
    {
        return hash('sha256', 'browser|'.preg_replace('/[\d._]+/', '', $userAgent));
    }
}
