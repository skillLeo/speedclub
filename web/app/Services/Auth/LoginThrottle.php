<?php

namespace App\Services\Auth;

use App\Exceptions\ApiException;
use App\Http\RateLimits;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Progressive delay per account after failed logins, never a hard lockout (02_PRODUCT_SPEC §8).
 *
 * The login action calls ensureAllowed() before checking the password, recordFailure() when it is wrong and clear()
 * when it is right. It passes the account's id where there is an account (ADR-136) and the typed address otherwise, so
 * unknown addresses count too and the behaviour reveals nothing about which accounts exist.
 */
final class LoginThrottle
{
    public static function accountSubject(User $user): string
    {
        return 'account:'.$user->getKey();
    }

    /**
     * @throws ApiException 429 with Retry-After while a delay is running
     */
    public function ensureAllowed(string $email): void
    {
        $wait = $this->secondsUntilAllowed($email);

        if ($wait > 0) {
            throw RateLimits::tooMany('login_delay', ['Retry-After' => $wait]);
        }
    }

    public function secondsUntilAllowed(string $email): int
    {
        $until = Cache::get($this->delayKey($email));

        return is_int($until) ? max(0, $until - now()->getTimestamp()) : 0;
    }

    /**
     * After N free failures the delay is base, 2 × base, 4 × base, up to the maximum.
     */
    public function recordFailure(string $email): void
    {
        $window = config()->integer('speedclub.login_delay.window_minutes') * 60;
        $free = config()->integer('speedclub.login_delay.free_failures');

        $failures = RateLimiter::increment($this->failuresKey($email), $window);

        if ($failures < $free) {
            return;
        }

        $delay = min(
            config()->integer('speedclub.login_delay.base_seconds') * (2 ** ($failures - $free)),
            config()->integer('speedclub.login_delay.max_seconds'),
        );

        Cache::put($this->delayKey($email), now()->getTimestamp() + $delay, $delay);
    }

    public function clear(string $email): void
    {
        RateLimiter::clear($this->failuresKey($email));
        Cache::forget($this->delayKey($email));
    }

    private function failuresKey(string $email): string
    {
        return 'login-failures:'.$this->identity($email);
    }

    private function delayKey(string $email): string
    {
        return 'login-delay:'.$this->identity($email);
    }

    /**
     * Hashed, so no email address ends up in the cache table.
     */
    private function identity(string $email): string
    {
        return hash('sha256', mb_strtolower(trim($email)));
    }
}
