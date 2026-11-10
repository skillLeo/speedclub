<?php

namespace App\Services\Auth;

use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\RateLimiter;

/**
 * One budget of wrong second factors per account (review must-fix 1), shared by the login challenge (AUTH-11), the re-checks of SET-05
 * and SET-13 (Reauthentication) and WEB-05. Every check here follows a correct password, so a failure means somebody holds it: the
 * owner gets a security mail on the first failure of an hour. 10 failures in an hour or 20 in a day lock the second factor
 * (users.two_factor_locked_at): no new challenge, no re-check, until a password reset by e-mail code (ResetMemberPassword) lifts it;
 * the day's count survives that reset.
 * With 1,000,000 codes and three valid at a time, 20 guesses a day give an attacker about 0.006 % a day.
 */
final class SecondFactorGuard
{
    public function __construct(private readonly Notifier $notifier) {}

    public function ensureAllowed(User $user): void
    {
        if ($user->fresh()?->hasLockedSecondFactor() ?? $user->hasLockedSecondFactor()) {
            throw new ApiException(ErrorCode::SecondFactorLocked);
        }
    }

    public function failed(User $user, ?string $deviceName = null): void
    {
        $hour = 'second-factor-fail-hour:'.$user->getKey();
        $day = 'second-factor-fail-day:'.$user->getKey();

        RateLimiter::hit($hour, 3600);
        RateLimiter::hit($day, 86400);

        if (RateLimiter::attempts($hour) >= config()->integer('speedclub.two_factor.failures_per_hour')
            || RateLimiter::attempts($day) >= config()->integer('speedclub.two_factor.failures_per_day')) {
            $this->lock($user, $deviceName);

            return;
        }

        $notice = 'second-factor-fail-notice:'.$user->getKey();

        if (! RateLimiter::tooManyAttempts($notice, 1)) {
            RateLimiter::hit($notice, 3600);
            $this->notifier->security($user, SecurityNotice::VerificationFailed, $deviceName, variant: 'second_factor');
        }
    }

    /**
     * A password reset by e-mail code proved the mailbox: the lock and the hourly counter go. The daily counter stays (SEC-P2-08):
     * whoever holds the mailbox and the password would otherwise get ten fresh guesses with every reset. With it, a reset after a
     * day's 20 failures opens the second factor for the owner, who knows the code, and the next wrong code locks it again.
     */
    public function unlock(User $user): void
    {
        foreach (['second-factor-fail-hour:', 'second-factor-fail-notice:'] as $prefix) {
            RateLimiter::clear($prefix.$user->getKey());
        }

        if ($user->hasLockedSecondFactor()) {
            $user->forceFill(['two_factor_locked_at' => null])->save();
        }
    }

    private function lock(User $user, ?string $deviceName): void
    {
        $updated = User::query()->whereKey($user->getKey())->whereNull('two_factor_locked_at')->update(['two_factor_locked_at' => now()]);
        $user->setAttribute('two_factor_locked_at', now());

        if ($updated === 1) {
            Audit::record(MemberSecurityEvent::SecondFactorLocked->value, $user, actor: $user);
            $this->notifier->security($user, SecurityNotice::VerificationFailed, $deviceName, variant: 'locked');
        }
    }
}
