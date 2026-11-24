<?php

namespace App\Actions\Account;

use App\Enums\ErrorCode;
use App\Enums\LoginPurpose;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Exceptions\ApiException;
use App\Exceptions\SecondFactorRefused;
use App\Models\LoginAttempt;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\EmailCodes;
use App\Services\Auth\SecondFactorGuard;
use App\Services\Auth\TwoFactor;
use App\Services\Notifications\Notifier;

/**
 * WEB-05 by e-mail code (client round 6, L3): spends the account_deletion code of this page (address + attempt id + code) and, when
 * two-factor is on, checks the second factor in the same step. Returns the account the caller then closes with DeleteAccount.
 *
 * - Wrong, unknown, used and expired codes answer as EmailCodes::consume does (InvalidCode, CodeExpired; EmailCodeLocked while this client
 *   is locked out of the address), counted and locked like the sign-in codes.
 * - A missing, wrong or locked second factor throws SecondFactorRefused from inside consume: the e-mail code stays usable for the next try,
 *   and a wrong one counts in SecondFactorGuard's per-account budget after the rollback.
 * - A code whose account has gone, changed or is closed already answers like a wrong code.
 */
class ProveDeletionByEmailCode
{
    public function __construct(
        private readonly EmailCodes $codes,
        private readonly TwoFactor $twoFactor,
        private readonly SecondFactorGuard $guard,
        private readonly Notifier $notifier,
    ) {}

    /**
     * @throws ApiException
     * @throws SecondFactorRefused
     */
    public function handle(string $email, string $attemptId, string $code, string $secondFactor): User
    {
        try {
            $user = $this->codes->consume(
                $email,
                $attemptId,
                LoginPurpose::AccountDeletion,
                $code,
                null,
                fn (LoginAttempt $row): ?User => $this->account($email, $row->user_id, $secondFactor),
                fn () => $this->locked($email),
            );
        } catch (SecondFactorRefused $refused) {
            if ($refused->reason === SecondFactorRefused::WRONG) {
                $this->guard->failed($refused->user);
            }

            throw $refused;
        }

        if (! $user instanceof User) {
            throw new ApiException(ErrorCode::InvalidCode, errors: ['code' => [ErrorCode::InvalidCode->message()]]);
        }

        return $user;
    }

    private function account(string $email, ?string $userId, string $secondFactor): ?User
    {
        $user = User::query()->where('email', $email)->first();

        if ($user === null || $userId === null || $user->id !== $userId || $user->isPendingDeletion()) {
            return null;
        }

        if ($user->hasTwoFactor()) {
            if ($user->hasLockedSecondFactor()) {
                throw new SecondFactorRefused($user, SecondFactorRefused::LOCKED);
            }

            if (trim($secondFactor) === '') {
                throw new SecondFactorRefused($user, SecondFactorRefused::REQUIRED);
            }

            if (! $this->twoFactor->verifyEither($user, $secondFactor)) {
                throw new SecondFactorRefused($user, SecondFactorRefused::WRONG);
            }
        }

        return $user;
    }

    /**
     * The tenth wrong code of an hour: the lock (EmailCodes) and, when the address has an account, the audit event and the security mail,
     * as at sign-in.
     */
    private function locked(string $email): void
    {
        $user = User::query()->where('email', $email)->first();

        if ($user === null) {
            return;
        }

        Audit::record(MemberSecurityEvent::EmailCodeLocked->value, $user, actor: $user);
        $this->notifier->security($user, SecurityNotice::EmailCodeLocked);
    }
}
