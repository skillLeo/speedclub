<?php

namespace App\Actions\Auth\Passwordless;

use App\Actions\Auth\SignInMember;
use App\Enums\ErrorCode;
use App\Enums\LoginPurpose;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Enums\SignInMethod;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\EmailCodes;
use App\Services\Auth\PasswordlessAccounts;
use App\Services\Notifications\Notifier;
use App\Support\Auth\DeviceInfo;
use App\Support\Auth\PasswordlessResult;
use App\Support\Auth\TwoFactorPending;
use Illuminate\Http\Request;

/**
 * AUTH-13 → POST auth/email/verify with attempt_id (09 §8.1): the code or the magic token of this attempt signs in, or creates the account
 * (pending_terms) when the address has none. The code proves the mailbox, so an unverified account of this address is proved on the way
 * (PasswordlessAccounts::proveMailbox). Two-factor applies as for the password (AUTH-11). A closed account answers like a wrong code.
 */
class SignInWithEmailCode
{
    public function __construct(
        private readonly EmailCodes $codes,
        private readonly PasswordlessAccounts $accounts,
        private readonly SignInMember $signIn,
        private readonly Notifier $notifier,
    ) {}

    public function handle(string $email, string $attemptId, ?string $code, ?string $magicToken, ?string $locale, ?DeviceInfo $device, Request $request): PasswordlessResult|TwoFactorPending
    {
        /** @var array{0: User, 1: bool}|null $found */
        $found = $this->codes->consume(
            $email,
            $attemptId,
            LoginPurpose::SignIn,
            $code,
            $code === null ? $magicToken : null,
            function () use ($email, $locale): ?array {
                [$user, $isNew] = $this->accounts->findOrCreate($email, $locale, 'email_code');

                if ($user->isPendingDeletion() || $user->trashed()) {
                    return null;
                }

                $this->accounts->proveMailbox($user);

                return [$user, $isNew];
            },
            fn () => $this->locked($email),
        );

        if ($found === null) {
            throw new ApiException(ErrorCode::InvalidCode, errors: ['code' => [ErrorCode::InvalidCode->message()]]);
        }

        [$user, $isNew] = $found;
        $result = $this->signIn->begin($user, $device, $request, method: SignInMethod::EmailCode);

        return $result instanceof TwoFactorPending ? $result : new PasswordlessResult($result, $isNew);
    }

    /**
     * The tenth failure of an hour: the lock (EmailCodes) and, when the address has an account, the audit event and the security mail.
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
