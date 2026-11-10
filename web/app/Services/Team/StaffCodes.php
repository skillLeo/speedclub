<?php

namespace App\Services\Team;

use App\Enums\StaffSecurityEvent;
use App\Models\Staff;
use App\Services\Audit\Audit;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Fortify\Contracts\TwoFactorAuthenticationProvider;
use Laravel\Fortify\Fortify;
use Throwable;

/**
 * The current TOTP code the ADM-51 steps ask for (SEC-P1-36, SEC-P1-39): rotation, recovery codes. Fortify's provider, which accepts
 * a code once per time window. Wrong codes are limited per account (speedclub.team.code_attempts_per_minute) and audited.
 */
final class StaffCodes
{
    public function __construct(private readonly TwoFactorAuthenticationProvider $provider) {}

    /**
     * A current code of the confirmed key, or of $secret (the pending key of a rotation).
     *
     * @throws TeamRefused no_two_factor, too_many_codes, code_invalid
     */
    public function ensure(Staff $staff, string $code, ?string $secret = null): void
    {
        if ($secret === null && ! $staff->hasEnabledTwoFactorAuthentication()) {
            throw new TeamRefused('no_two_factor');
        }

        $key = 'staff-account-code:'.$staff->getKey();
        $max = max(1, config()->integer('speedclub.team.code_attempts_per_minute'));

        if (RateLimiter::tooManyAttempts($key, $max)) {
            throw new TeamRefused('too_many_codes', ['seconds' => RateLimiter::availableIn($key)]);
        }

        if (preg_match('/\A\d{6}\z/', $code) === 1 && $this->provider->verify($secret ?? $this->secret($staff), $code)) {
            return;
        }

        RateLimiter::hit($key, 60);
        Audit::record(StaffSecurityEvent::CodeCheckFailed->value, $staff, actor: $staff);

        throw new TeamRefused('code_invalid');
    }

    private function secret(Staff $staff): string
    {
        try {
            return (string) Fortify::currentEncrypter()->decrypt((string) $staff->two_factor_secret);
        } catch (Throwable) {
            throw new TeamRefused('no_two_factor');
        }
    }
}
