<?php

namespace App\Services\Auth;

use App\Models\PersonalAccessToken;
use App\Models\User;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Http\Request;

/**
 * "Sudo mode" (09 §8.1): when the member last proved themselves on this token or browser session. A sign-in counts (the token's
 * reauthenticated_at is set when it is issued, the session's key when it starts), and so does POST me/reauth. A rotated token starts
 * without a stamp. A native biometric prompt is never server proof.
 */
final class RecentAuthentication
{
    public const SESSION_KEY = 'member.reauthenticated_at';

    public function mark(User $user, Request $request): CarbonImmutable
    {
        $now = CarbonImmutable::now();
        $token = $user->currentAccessToken();

        if ($token instanceof PersonalAccessToken && $token->exists) {
            $token->forceFill(['reauthenticated_at' => $now])->save();
        } elseif ($request->hasSession()) {
            $request->session()->put(self::SESSION_KEY, $now->getTimestamp());
        }

        return $now;
    }

    public function at(User $user, Request $request): ?CarbonImmutable
    {
        $token = $user->currentAccessToken();

        if ($token instanceof PersonalAccessToken && $token->exists) {
            $at = $token->getAttribute('reauthenticated_at');

            return $at instanceof DateTimeInterface ? CarbonImmutable::instance($at) : (is_string($at) ? CarbonImmutable::parse($at) : null);
        }

        if ($request->hasSession()) {
            $at = $request->session()->get(self::SESSION_KEY);

            return is_int($at) ? CarbonImmutable::createFromTimestamp($at) : null;
        }

        return null;
    }

    public function isRecent(User $user, Request $request, ?int $minutes = null): bool
    {
        $at = $this->at($user, $request);
        $minutes ??= config()->integer('speedclub.reauth.recent_minutes');

        return $at !== null && $at->greaterThan(CarbonImmutable::now()->subMinutes($minutes));
    }

    /**
     * Until when the proof counts, for the answer of POST me/reauth.
     */
    public function until(User $user, Request $request): ?CarbonImmutable
    {
        return $this->at($user, $request)?->addMinutes(config()->integer('speedclub.reauth.recent_minutes'));
    }

    /**
     * What this member can use in POST me/reauth, for the 403 reauthentication_required.
     *
     * @return list<string>
     */
    public static function methods(User $user): array
    {
        return array_values(array_filter([
            $user->memberPasskeys()->exists() ? 'passkey' : null,
            'email_code',
            $user->hasPassword() ? 'password' : null,
        ]));
    }
}
