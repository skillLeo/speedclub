<?php

namespace App\Actions\Auth;

use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Exceptions\ApiException;
use App\Http\RateLimits;
use App\Services\Audit\Audit;
use App\Services\Auth\SecondFactorGuard;
use App\Services\Auth\TwoFactor;
use App\Services\Auth\TwoFactorChallenges;
use App\Services\Notifications\Notifier;
use App\Support\Auth\AuthResult;
use App\Support\Auth\DeviceInfo;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

/**
 * AUTH-11: the second factor, then the same sign-in as without it (SignInMember: token or session, new-device notice, forced password
 * change). At most 5 wrong codes a minute per challenge and per account, and the long per-account budget of SecondFactorGuard (10 an
 * hour, 20 a day, then locked until a reset). The challenge is taken atomically and spent by the first right code. A recovery code is gone
 * once used, and the owner gets a mail naming how many are left (02_PRODUCT_SPEC §3.1).
 */
class PassTwoFactorChallenge
{
    public function __construct(
        private readonly TwoFactorChallenges $challenges,
        private readonly TwoFactor $twoFactor,
        private readonly SignInMember $signIn,
        private readonly SecondFactorGuard $guard,
        private readonly Notifier $notifier,
    ) {}

    public function handle(string $challenge, ?string $code, ?string $recoveryCode, ?DeviceInfo $device, Request $request): AuthResult
    {
        $taken = $this->challenges->take($challenge, $device, $request);

        if ($taken === null) {
            throw new ApiException(ErrorCode::ChallengeExpired);
        }

        $user = $taken['user'];
        $max = config()->integer('speedclub.two_factor.challenge_attempts_per_minute');
        $keys = [$this->challenges->limiterKey($challenge), 'two-factor-account:'.$user->getKey()];

        foreach ($keys as $key) {
            if (RateLimiter::tooManyAttempts($key, $max)) {
                $this->challenges->putBack($challenge, $taken['entry']);

                throw RateLimits::tooMany('two_factor_challenge', ['Retry-After' => RateLimiter::availableIn($key)]);
            }
        }

        // Locked meanwhile: the challenge is spent, the sign-in starts over after a reset.
        $this->guard->ensureAllowed($user);

        $usedRecovery = $recoveryCode !== null && $recoveryCode !== '';
        $passed = $usedRecovery
            ? $this->twoFactor->useRecoveryCode($user, $recoveryCode)
            : $this->twoFactor->verifyCode($user, (string) $code);

        if (! $passed) {
            foreach ($keys as $key) {
                RateLimiter::hit($key, 60);
            }

            $this->guard->failed($user, $device?->name);

            if (! $user->fresh()?->hasLockedSecondFactor()) {
                $this->challenges->putBack($challenge, $taken['entry']);
            }

            $field = $usedRecovery ? 'recovery_code' : 'code';

            throw ValidationException::withMessages([$field => [(string) __('settings.code_wrong')]]);
        }

        RateLimiter::clear($keys[1]);

        $result = $this->signIn->handle($user, $device, $request);

        if ($usedRecovery) {
            $left = $this->twoFactor->remainingRecoveryCodes($user);

            Audit::record(MemberSecurityEvent::RecoveryCodeUsed->value, $user, after: ['left' => $left], actor: $user);
            $this->notifier->security($user, SecurityNotice::RecoveryCodeUsed, $device?->name, count: $left);
        }

        return $result;
    }
}
