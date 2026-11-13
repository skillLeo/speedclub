<?php

namespace App\Actions\Auth\Social;

use App\Actions\Auth\SignInMember;
use App\Enums\ErrorCode;
use App\Enums\LoginPurpose;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Enums\SignInMethod;
use App\Exceptions\ApiException;
use App\Models\LoginAttempt;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\EmailCodes;
use App\Services\Auth\IdTokens\SocialAccounts;
use App\Services\Notifications\Notifier;
use App\Support\Auth\AuthResult;
use App\Support\Auth\DeviceInfo;
use App\Support\Auth\PasswordlessResult;
use App\Support\Auth\PendingProviderLink;
use App\Support\Auth\TwoFactorPending;
use Illuminate\Http\Request;

/**
 * AUTH-16 → POST auth/link/confirm (09 §8.1): the code sent to the existing account's address proves its owner; only then the provider
 * identity kept (encrypted) with the code is linked, and the member is signed in. The code is a second proof besides the provider, so
 * two-factor applies here as for an e-mail code sign-in, and on such an account the link is made only after it (SEC-M46-02). Wrong codes count like every e-mail code (5 per code, lock after 10 an hour).
 */
class ConfirmProviderLink
{
    public function __construct(
        private readonly EmailCodes $codes,
        private readonly SocialAccounts $social,
        private readonly SignInMember $signIn,
        private readonly Notifier $notifier,
    ) {}

    public function handle(string $attemptId, string $code, ?DeviceInfo $device, Request $request): PasswordlessResult|TwoFactorPending
    {
        $row = LoginAttempt::query()
            ->where('attempt_hash', EmailCodes::attemptHash($attemptId))
            ->where('purpose', LoginPurpose::Link)
            ->latest('created_at')
            ->first();
        $user = $row?->user;

        if ($row === null || $user === null) {
            // The same hash work as a real check.
            hash_equals(EmailCodes::codeHash($attemptId, $code), str_repeat('0', 64));

            throw new ApiException(ErrorCode::InvalidCode, errors: ['code' => [ErrorCode::InvalidCode->message()]]);
        }

        /** @var array<string, mixed> $link */
        $link = $this->codes->consume($user->email, $attemptId, LoginPurpose::Link, $code, null, function (LoginAttempt $spent): array {
            /** @var array<string, mixed> $payload */
            $payload = $spent->getAttribute('payload') ?? [];

            if (PendingProviderLink::identity($payload) === null) {
                throw new ApiException(ErrorCode::InvalidCode, errors: ['code' => [ErrorCode::InvalidCode->message()]]);
            }

            return PendingProviderLink::carry($payload);
        }, function () use ($user): void {
            Audit::record(MemberSecurityEvent::EmailCodeLocked->value, $user, actor: $user);
            $this->notifier->security($user, SecurityNotice::EmailCodeLocked);
        });

        /** @var User $user */
        // SEC-M46-02: with two-factor on, the code proves the mailbox only. The link travels inside the challenge and is made once the
        // second factor passed (PassTwoFactorChallenge); a mailbox alone never adds a way in that skips it.
        if ($user->hasTwoFactor()) {
            $pending = $this->signIn->begin($user, $device, $request, ['link' => $link], $this->method($link));

            return $pending instanceof AuthResult ? new PasswordlessResult($pending, false) : $pending;
        }

        $identity = PendingProviderLink::identity($link);

        if ($identity !== null) {
            $this->social->link($user, $identity, notify: true, authorizationCode: PendingProviderLink::authorizationCode($link));
        }

        $result = $this->signIn->begin($user, $device, $request, method: $this->method($link));

        return $result instanceof AuthResult ? new PasswordlessResult($result, false) : $result;
    }

    /**
     * @param  array<string, mixed>  $link
     */
    private function method(array $link): ?SignInMethod
    {
        $identity = PendingProviderLink::identity($link);

        return $identity === null ? null : SignInMethod::forProvider($identity->provider);
    }
}
