<?php

namespace App\Actions\Auth;

use App\Enums\AuthNextStep;
use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Enums\VerificationPurpose;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\LoginThrottle;
use App\Services\Auth\MemberSessions;
use App\Services\Auth\SecondFactorGuard;
use App\Services\Auth\VerificationCodes;
use App\Services\Notifications\Notifier;
use App\Support\Auth\NextStep;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Issues no auth: the member signs in with the new password, which also proves it was typed correctly. The code proved
 * the address, so an account still waiting for verification counts as verified from here on, and what was set on it
 * before that goes (ADR-135).
 */
class ResetMemberPassword
{
    public function __construct(
        private readonly VerificationCodes $codes,
        private readonly Notifier $notifier,
        private readonly MemberSessions $sessions,
        private readonly ClearUnprovenAccountData $unproven,
        private readonly LoginThrottle $throttle,
        private readonly SecondFactorGuard $secondFactor,
    ) {}

    public function handle(string $email, string $code, string $password): NextStep
    {
        $user = User::query()->where('email', $email)->first();

        if ($user !== null && $user->isDeactivated()) {
            $user = null;
        }

        $done = $this->codes->consume($user, VerificationPurpose::PasswordReset, $code, function () use ($user, $password): void {
            /** @var User $user */
            $this->replacePassword($user, $password);
        });

        if (! $done) {
            throw new ApiException(ErrorCode::InvalidCode, errors: ['code' => [ErrorCode::InvalidCode->message()]]);
        }

        /** @var User $user */
        // The failures were someone typing the old password. The new one has to work right away.
        $this->throttle->clear(LoginThrottle::accountSubject($user));

        $this->notifier->security($user, SecurityNotice::PasswordChanged);

        return new NextStep(AuthNextStep::SignIn, $email, status: 200);
    }

    private function replacePassword(User $user, string $password): void
    {
        // After the code check, because an earlier answer would link an address to a username for anybody.
        if ($user->username !== null && mb_strtolower($password) === $user->username) {
            throw ValidationException::withMessages(['password' => [(string) __('passwords.rules.same_as_username')]]);
        }

        // A forced change exists because the old password is no longer trusted: typing it again must not clear the flag.
        // After the code check as well, since this answer says what the password is.
        if ($user->getAttribute('force_password_change') === true && Hash::check($password, $user->getAuthPassword())) {
            throw ValidationException::withMessages(['password' => [(string) __('passwords.rules.same_as_current')]]);
        }

        $wasUnproven = $user->getAttribute('email_verified_at') === null;

        $user->forceFill([
            'password' => Hash::make($password),
            'force_password_change' => false,
            'remember_token' => Str::random(60),
            'email_verified_at' => $user->getAttribute('email_verified_at') ?? now(),
        ])->save();

        // The e-mail code proved the mailbox: a second factor locked by wrong codes opens again (SecondFactorGuard).
        $this->secondFactor->unlock($user);

        $revoked = $this->sessions->revokeAll($user);

        Audit::record(MemberSecurityEvent::LogoutAll->value, $user, after: $revoked, actor: $user);
        Audit::record(MemberSecurityEvent::PasswordReset->value, $user, actor: $user);

        if ($wasUnproven) {
            $this->unproven->handle($user);
        }
    }
}
