<?php

namespace App\Services\Auth;

use App\Models\User;
use App\Support\Auth\DeviceInfo;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Str;

/**
 * The step between a correct password (or e-mail code) and the session for an account with two-factor (AUTH-11). The challenge is a
 * random 40-character token the client holds for 5 minutes; the cache keeps only its HMAC, the member's id, a keyed hash of the
 * remember token (a password or e-mail change since ends the challenge) and what asked: the app install (DeviceInfo fingerprint) or the
 * browser session. Another device or kind cannot use it (review should-fix 6).
 *
 * Single use, atomically (should-fix 7): take() pulls the entry out of the cache, so two requests can never both use it; a wrong code
 * puts it back for the rest of its 5 minutes.
 */
final class TwoFactorChallenges
{
    public const TTL_SECONDS = 300;

    /**
     * @param  array<string, mixed>  $pending  applied after the second factor (SEC-M46-02); encrypted in the cache, as it may hold a
     *                                         provider identity and an Apple authorization code
     */
    public function issue(User $user, ?DeviceInfo $device, Request $request, array $pending = []): string
    {
        $token = Str::random(40);

        Cache::put($this->key($token), [
            'user_id' => $user->getKey(),
            'remember' => $this->rememberHash($user),
            'bound_to' => $this->boundTo($device, $request),
            'expires_at' => now()->addSeconds(self::TTL_SECONDS)->getTimestamp(),
            'pending' => $pending === [] ? null : Crypt::encrypt($pending),
        ], self::TTL_SECONDS);

        return $token;
    }

    /**
     * Takes the challenge out of the cache. Null when it is unknown, spent, expired, of another device or kind, or the account changed
     * its remember token since. A taken challenge is gone until put back.
     *
     * @return array{user: User, entry: array<string, mixed>}|null
     */
    public function take(string $token, ?DeviceInfo $device, Request $request): ?array
    {
        $entry = Cache::pull($this->key($token));

        if (! is_array($entry) || ! is_string($entry['user_id'] ?? null) || (int) ($entry['expires_at'] ?? 0) <= now()->getTimestamp()) {
            return null;
        }

        if (! hash_equals((string) ($entry['bound_to'] ?? ''), $this->boundTo($device, $request))) {
            // Not this device's: back for the device that asked, untouched.
            $this->putBack($token, $entry);

            return null;
        }

        $user = User::query()->whereKey($entry['user_id'])->first();

        if ($user === null || ! hash_equals((string) ($entry['remember'] ?? ''), $this->rememberHash($user))) {
            return null;
        }

        return ['user' => $user, 'entry' => $entry];
    }

    /**
     * What issue() was given to apply after the second factor; empty when nothing (or it cannot be read).
     *
     * @param  array<string, mixed>  $entry
     * @return array<string, mixed>
     */
    public static function pending(array $entry): array
    {
        $sealed = $entry['pending'] ?? null;

        if (! is_string($sealed)) {
            return [];
        }

        try {
            $pending = Crypt::decrypt($sealed);
        } catch (DecryptException) {
            return [];
        }

        return is_array($pending) ? $pending : [];
    }

    /**
     * A wrong code: the challenge stays usable for the rest of its 5 minutes.
     *
     * @param  array<string, mixed>  $entry
     */
    public function putBack(string $token, array $entry): void
    {
        $left = (int) ($entry['expires_at'] ?? 0) - now()->getTimestamp();

        if ($left > 0) {
            Cache::put($this->key($token), $entry, $left);
        }
    }

    /**
     * An opaque key per challenge for the attempt limiter: the token itself never reaches a cache key in clear.
     */
    public function limiterKey(string $token): string
    {
        return 'two-factor-challenge:'.hash('sha256', $token);
    }

    private function boundTo(?DeviceInfo $device, Request $request): string
    {
        if ($device !== null) {
            return 'device:'.$device->fingerprint();
        }

        return 'session:'.hash_hmac('sha256', $request->hasSession() ? $request->session()->getId() : '', config()->string('app.key'));
    }

    private function rememberHash(User $user): string
    {
        return hash_hmac('sha256', 'remember|'.(string) $user->getRememberToken(), config()->string('app.key'));
    }

    private function key(string $token): string
    {
        return 'two-factor-challenge-token:'.hash_hmac('sha256', $token, config()->string('app.key'));
    }
}
