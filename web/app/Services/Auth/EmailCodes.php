<?php

namespace App\Services\Auth;

use App\Enums\ErrorCode;
use App\Enums\LoginPurpose;
use App\Exceptions\ApiException;
use App\Models\LoginAttempt;
use App\Models\User;
use App\Services\Security\FailedSignIns;
use App\Support\Auth\IssuedEmailCode;
use App\Support\ClientAddress;
use Closure;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

/**
 * The passwordless e-mail codes of 09 §8.1 (login_attempts). Everything is keyed by a hash of the address, never by an account, so the
 * same limits and answers hold whether or not the address has one.
 *
 * - Code: 6 digits, HMAC-SHA256(app key, attempt id + code); TTL 10 minutes; single use; constant-time compare; 5 wrong tries per code.
 * - Magic link: a 256-bit token, stored as HMAC(app key, attempt id + token). The attempt id is the client's secret and never part of
 *   the link, so the link signs in only the device that asked for the code (same-device, attempt-bound).
 * - Per address and purpose: 5 codes an hour; cooldowns 30 → 60 → 120 s between codes. A sign-in code someone else asks for never uses
 *   up the budget of a reauth or link code (SEC-M46-03).
 * - Failures count only against an attempt that exists for the address (5 per code) and per address and client IP: 10 an hour lock that
 *   IP out of the address for 15 minutes. An unknown attempt id is a plain wrong answer: a stranger cannot lock someone else's address
 *   (SEC-M46-03); the per-IP limiter auth-email-verify bounds the guessing.
 *
 * A new code closes the open codes of the same address and purpose.
 */
final class EmailCodes
{
    public static function emailHash(string $email): string
    {
        return hash_hmac('sha256', 'login-email|'.mb_strtolower(trim($email)), config()->string('app.key'));
    }

    public static function attemptHash(string $attemptId): string
    {
        return hash_hmac('sha256', 'login-attempt|'.$attemptId, config()->string('app.key'));
    }

    public static function codeHash(string $attemptId, string $code): string
    {
        return hash_hmac('sha256', $attemptId.$code, config()->string('app.key'));
    }

    public static function magicHash(string $attemptId, string $token): string
    {
        return hash_hmac('sha256', 'magic|'.$attemptId.'|'.$token, config()->string('app.key'));
    }

    /**
     * Null while the address is locked, in its cooldown or above 5 codes an hour: the caller stays neutral and sends nothing.
     *
     * @param  array<string, mixed>|null  $payload  encrypted at rest (the provider identity of an AUTH-16 link)
     */
    public function issue(
        string $email,
        string $attemptId,
        LoginPurpose $purpose,
        ?string $userId,
        ?string $locale = null,
        ?string $platform = null,
        ?array $payload = null,
    ): ?IssuedEmailCode {
        $emailHash = self::emailHash($email);

        // Serialises issue per address, also before the address has any row. A named lock, not SELECT … FOR UPDATE on the address's
        // newest row: with no row that takes gap locks every caller gets at once, and their inserts then deadlock each other (three
        // parallel starts answered 500, M4.6 app lane). GET_LOCK works the same on MySQL 8 and MariaDB and needs no table.
        $lock = 'sc-email-code:'.substr($emailHash, 0, 40);

        if ((int) DB::scalar('SELECT GET_LOCK(?, ?)', [$lock, config()->integer('speedclub.email_code.lock_wait_seconds')]) !== 1) {
            throw new ApiException(ErrorCode::ServiceUnavailable);
        }

        try {
            return DB::transaction(fn (): ?IssuedEmailCode => $this->issueLocked($email, $emailHash, $attemptId, $purpose, $userId, $locale, $platform, $payload), 3);
        } finally {
            DB::scalar('SELECT RELEASE_LOCK(?)', [$lock]);
        }
    }

    /**
     * @param  array<string, mixed>|null  $payload
     */
    private function issueLocked(string $email, string $emailHash, string $attemptId, LoginPurpose $purpose, ?string $userId, ?string $locale, ?string $platform, ?array $payload): ?IssuedEmailCode
    {
        if ($this->lockedFor($emailHash) > 0 || $this->waitFor($emailHash, $purpose) > 0) {
            return null;
        }

        $open = LoginAttempt::query()
            ->where('email_hash', $emailHash)
            ->where('purpose', $purpose)
            ->whereNull('consumed_at')
            ->pluck('id')
            ->all();

        if ($open !== []) {
            LoginAttempt::query()->whereKey($open)->update(['consumed_at' => now()]);
        }

        $code = $this->generate();
        $magic = Str::random(43);

        $row = new LoginAttempt;
        $row->forceFill([
            'email_hash' => $emailHash,
            'attempt_hash' => self::attemptHash($attemptId),
            'user_id' => $userId,
            'purpose' => $purpose,
            'code_hash' => self::codeHash($attemptId, $code),
            'magic_hash' => $purpose === LoginPurpose::SignIn ? self::magicHash($attemptId, $magic) : null,
            'expires_at' => now()->addMinutes(config()->integer('speedclub.email_code.expires_minutes')),
            'locale' => $locale,
            'platform' => $platform,
            'payload' => $payload,
        ])->save();

        return new IssuedEmailCode($email, $code, $purpose === LoginPurpose::SignIn ? $magic : null);
    }

    /**
     * Seconds until the next code of this purpose may be asked for: the lock, the cooldown after the last code, or the wait for the hourly
     * limit.
     */
    public function resendAfter(string $email, LoginPurpose $purpose): int
    {
        $hash = self::emailHash($email);

        return max($this->lockedFor($hash), $this->waitFor($hash, $purpose));
    }

    /**
     * The open code of this attempt, checked in constant time. $then runs inside the transaction with the spent row; if it throws, the code
     * stays unused and no failure is counted.
     *
     * Answers: 422 invalid_code (with attempts_left) for a wrong, unknown, used or exhausted code; 422 code_expired for an expired one;
     * 429 email_code_locked while this client is locked out of the address. A wrong code of an existing attempt counts on the address and
     * client IP; the tenth in an hour starts the lock and calls $onLock once. An unknown, used or exhausted attempt counts nothing.
     *
     * @template TResult
     *
     * @param  Closure(LoginAttempt): TResult  $then
     * @param  Closure(): void  $onLock
     * @return TResult
     */
    public function consume(string $email, string $attemptId, LoginPurpose $purpose, ?string $code, ?string $magic, Closure $then, Closure $onLock)
    {
        $emailHash = self::emailHash($email);
        $this->ensureNotLocked($emailHash);

        $outcome = DB::transaction(function () use ($emailHash, $attemptId, $purpose, $code, $magic, $then): array {
            $row = LoginAttempt::query()
                ->where('attempt_hash', self::attemptHash($attemptId))
                ->where('email_hash', $emailHash)
                ->where('purpose', $purpose)
                ->latest('created_at')
                ->lockForUpdate()
                ->first();

            // The same hash work for every answer.
            $given = $code !== null ? self::codeHash($attemptId, $code) : self::magicHash($attemptId, (string) $magic);
            $expected = $code !== null ? $row?->code_hash : $row?->magic_hash;
            $matches = hash_equals((string) ($expected ?? str_repeat('0', 64)), $given);

            if ($row === null || $row->consumed_at !== null || $row->attempts >= config()->integer('speedclub.email_code.max_attempts')) {
                return ['failed' => true, 'counts' => false, 'expired' => false, 'left' => 0];
            }

            if ($row->expires_at === null || ! $row->expires_at->isFuture()) {
                return ['failed' => false, 'counts' => false, 'expired' => true, 'left' => 0];
            }

            if (! $matches || $expected === null) {
                $row->increment('attempts');

                return ['failed' => true, 'counts' => true, 'user_id' => $row->user_id, 'expired' => false, 'left' => max(0, config()->integer('speedclub.email_code.max_attempts') - $row->attempts)];
            }

            $row->forceFill(['consumed_at' => now()])->save();

            return ['failed' => false, 'counts' => false, 'expired' => false, 'result' => $then($row)];
        });

        if ($outcome['expired']) {
            throw new ApiException(ErrorCode::CodeExpired, errors: ['code' => [ErrorCode::CodeExpired->message()]]);
        }

        if ($outcome['failed']) {
            if ($outcome['counts']) {
                $this->recordFailure($emailHash, $onLock);

                // SET-21 (09 §8.4): a wrong sign-in or link code of an account, after the response.
                $account = is_string($outcome['user_id'] ?? null) && in_array($purpose, [LoginPurpose::SignIn, LoginPurpose::Link], true)
                    ? User::query()->find($outcome['user_id'])
                    : null;

                if ($account !== null) {
                    app(FailedSignIns::class)->later($account, 'email_code');
                }
            }

            throw new ApiException(
                ErrorCode::InvalidCode,
                (string) trans_choice('auth.email_code.wrong', $outcome['left'], ['count' => $outcome['left']]),
                errors: ['code' => [ErrorCode::InvalidCode->message()]],
                data: ['attempts_left' => $outcome['left']],
            );
        }

        RateLimiter::clear(self::failureKey($emailHash));

        return $outcome['result'];
    }

    /**
     * Seconds left of the 15-minute lock of this address for the client of this request, 0 when none.
     */
    public function lockedFor(string $emailHash): int
    {
        $until = Cache::get(self::lockKey($emailHash));

        return is_int($until) ? max(0, $until - now()->getTimestamp()) : 0;
    }

    private function ensureNotLocked(string $emailHash): void
    {
        $seconds = $this->lockedFor($emailHash);

        if ($seconds > 0) {
            throw self::locked($seconds);
        }
    }

    public static function locked(int $seconds): ApiException
    {
        $minutes = max(1, (int) ceil($seconds / 60));

        return new ApiException(
            ErrorCode::EmailCodeLocked,
            (string) __('errors.email_code_locked', ['time' => trans_choice('rate_limits.time.minutes', $minutes, ['count' => $minutes])]),
            headers: ['Retry-After' => (string) $seconds],
            data: ['retry_after' => $seconds],
        );
    }

    /**
     * The lock shuts out this client only; the owner's own code from elsewhere stays usable. The security mail goes at most once an hour per
     * address, so many addresses of one attacker cannot flood the owner either.
     *
     * @param  Closure(): void  $onLock
     */
    private function recordFailure(string $emailHash, Closure $onLock): void
    {
        $key = self::failureKey($emailHash);
        RateLimiter::hit($key, 3600);

        if (RateLimiter::attempts($key) >= config()->integer('speedclub.email_code.max_failures_per_hour')) {
            $until = now()->addMinutes(config()->integer('speedclub.email_code.lock_minutes'));
            Cache::put(self::lockKey($emailHash), $until->getTimestamp(), $until);
            RateLimiter::clear($key);

            $notice = 'email-code-lock-notice:'.$emailHash;

            if (! RateLimiter::tooManyAttempts($notice, 1)) {
                RateLimiter::hit($notice, 3600);
                $onLock();
            }
        }
    }

    /**
     * The cooldown still running after the newest code, or the wait until the oldest of the last hour's codes drops out.
     */
    private function waitFor(string $emailHash, LoginPurpose $purpose): int
    {
        $recent = LoginAttempt::query()
            ->where('email_hash', $emailHash)
            ->where('purpose', $purpose)
            ->where('created_at', '>', now()->subHour())
            ->orderByDesc('created_at')
            ->pluck('created_at');

        if ($recent->isEmpty()) {
            return 0;
        }

        /** @var Carbon $newest */
        $newest = $recent->first();
        $cooldown = $this->cooldownAfter($recent->count());
        $wait = max(0, (int) ceil($newest->copy()->addSeconds($cooldown)->getTimestamp() - now()->getTimestamp()));

        if ($recent->count() >= config()->integer('speedclub.email_code.max_codes_per_hour')) {
            /** @var Carbon $oldest */
            $oldest = $recent->last();
            $wait = max($wait, (int) ceil($oldest->copy()->addHour()->getTimestamp() - now()->getTimestamp()));
        }

        return $wait;
    }

    /**
     * 30 s after the first code of the hour, 60 s after the second, 120 s from then on.
     */
    private function cooldownAfter(int $codes): int
    {
        /** @var list<int> $steps */
        $steps = config()->array('speedclub.email_code.resend_cooldowns');

        return (int) ($steps[min(max(0, $codes - 1), count($steps) - 1)] ?? 120);
    }

    private function generate(): string
    {
        $length = config()->integer('speedclub.email_code.code_length');

        return str_pad((string) random_int(0, (10 ** $length) - 1), $length, '0', STR_PAD_LEFT);
    }

    private static function failureKey(string $emailHash): string
    {
        return 'email-code-failures:'.$emailHash.'|'.self::client();
    }

    private static function lockKey(string $emailHash): string
    {
        return 'email-code-lock:'.$emailHash.'|'.self::client();
    }

    /**
     * The client IP of this request (an IPv6 client by its /64), hashed into the cache key.
     */
    private static function client(): string
    {
        return hash('sha256', ClientAddress::key(request()));
    }
}
