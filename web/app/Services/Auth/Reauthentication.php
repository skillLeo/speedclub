<?php

namespace App\Services\Auth;

use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Exceptions\ApiException;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

/**
 * The password again before a security change (SET-03 to SET-06, SET-12, SET-13), and the second factor where the contract asks for
 * it. Wrong answers are 422 on the field, so the screen can mark it. A wrong password is somebody on a signed-in device who does not
 * know it: 5 an hour per account (speedclub.reauth), an audit event and, once an hour, a security mail. Second factors count in the one
 * budget of SecondFactorGuard.
 */
final class Reauthentication
{
    public function __construct(
        private readonly TwoFactor $twoFactor,
        private readonly SecondFactorGuard $guard,
        private readonly Notifier $notifier,
    ) {}

    public function password(User $user, string $password, string $field = 'password'): void
    {
        // M4.6 sudo mode (09 §8.1): within 10 minutes of a sign-in or POST me/reauth the password may be left out; one that is sent is
        // still checked. A passwordless account has no other way through these endpoints.
        if ($password === '' && app(RecentAuthentication::class)->isRecent($user, request())) {
            return;
        }

        $key = 'reauth-password:'.$user->getKey();

        if (RateLimiter::tooManyAttempts($key, config()->integer('speedclub.reauth.password_failures_per_hour'))) {
            $seconds = max(1, RateLimiter::availableIn($key));

            throw new ApiException(ErrorCode::RateLimited, (string) __('settings.password_locked', ['time' => $this->minutes($seconds)]), headers: ['Retry-After' => (string) $seconds]);
        }

        if ($password !== '' && Hash::check($password, $user->getAuthPassword())) {
            return;
        }

        RateLimiter::hit($key, 3600);
        Audit::record(MemberSecurityEvent::PasswordCheckFailed->value, $user, actor: $user);

        if (RateLimiter::attempts($key) === 1) {
            $this->notifier->security($user, SecurityNotice::VerificationFailed, $this->device($user), variant: 'password');
        }

        throw ValidationException::withMessages([$field => [(string) __('settings.password_wrong')]]);
    }

    /**
     * Only when two-factor is on. Accepts a TOTP code or a recovery code; a recovery code is spent. Returns the factor that passed
     * ("totp" or "recovery_code"), or null without two-factor, for the audit log.
     */
    public function secondFactor(User $user, ?string $code): ?string
    {
        if (! $user->hasTwoFactor()) {
            return null;
        }

        $this->guard->ensureAllowed($user);

        $code = trim((string) $code);

        if ($code === '') {
            throw ValidationException::withMessages(['code' => [(string) __('settings.code_required')]]);
        }

        $factor = preg_match('/\A\d{6}\z/', $code) === 1 ? 'totp' : 'recovery_code';

        if (! $this->twoFactor->verifyEither($user, $code)) {
            $this->guard->failed($user, $this->device($user));

            throw ValidationException::withMessages(['code' => [(string) __('settings.code_wrong')]]);
        }

        return $factor;
    }

    /**
     * SEC-P2-07: an e-mail or password change on an account with two-factor also asks for a current code (or a recovery code). Without
     * one the answer is 422 two_factor_code_required, so the app can ask for it and send both again; a wrong one counts in the
     * second-factor budget like every other re-check. Call after password(): a wrong password is answered first.
     */
    public function secondFactorForChange(User $user, ?string $code): ?string
    {
        if ($user->hasTwoFactor() && trim((string) $code) === '') {
            $this->guard->ensureAllowed($user);

            throw new ApiException(ErrorCode::TwoFactorCodeRequired, errors: ['code' => [ErrorCode::TwoFactorCodeRequired->message()]]);
        }

        return $this->secondFactor($user, $code);
    }

    private function device(User $user): ?string
    {
        $token = $user->currentAccessToken();

        return $token instanceof PersonalAccessToken && $token->exists ? $token->deviceName() : null;
    }

    private function minutes(int $seconds): string
    {
        $minutes = max(1, (int) ceil($seconds / 60));

        return trans_choice('rate_limits.time.minutes', $minutes, ['count' => $minutes]);
    }
}
