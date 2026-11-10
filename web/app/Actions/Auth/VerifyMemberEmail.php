<?php

namespace App\Actions\Auth;

use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\VerificationPurpose;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\MemberSessions;
use App\Services\Auth\PasswordProof;
use App\Services\Auth\VerificationCodes;
use App\Support\Auth\AuthResult;
use App\Support\Auth\DeviceInfo;
use App\Support\Auth\TwoFactorPending;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class VerifyMemberEmail
{
    public function __construct(
        private readonly VerificationCodes $codes,
        private readonly PasswordProof $passwords,
        private readonly MemberSessions $sessions,
        private readonly SignInMember $signIn,
    ) {}

    /**
     * The code proves the mailbox, the password proves this is the account's registrant (ADR-135): anybody can register
     * somebody else's address first, and the code reaches the real owner. A request signed in as the account has already
     * shown the password. Wrong, unknown, expired, used and a password that does not match all read the same. A wrong
     * password does not touch the code, so a stranger cannot spend the owner's attempts.
     *
     * Success marks the address verified, ends every earlier sign-in and signs in, which for a member flagged
     * force_password_change means the same 403 and reset code as at login.
     */
    public function handle(string $email, string $code, ?string $password, ?User $signedIn, ?DeviceInfo $device, Request $request): AuthResult|TwoFactorPending
    {
        $user = User::query()->where('email', $email)->whereNull('email_verified_at')->first();

        // A closed account (deletion pending) is unknown here as at sign-in: the same answer as a wrong code (review nit 23).
        if ($user !== null && $user->isPendingDeletion()) {
            $user = null;
        }

        $isOwner = $user !== null && $signedIn !== null && $signedIn->is($user);

        if (! $isOwner && ! $this->passwords->check($user, $password ?? '')) {
            throw $this->invalid();
        }

        $verified = $this->codes->consume($user, VerificationPurpose::EmailVerification, $code, function () use ($user): void {
            /** @var User $user */
            $user->forceFill(['email_verified_at' => now(), 'remember_token' => Str::random(60)])->save();

            Audit::record(MemberSecurityEvent::EmailVerified->value, $user, actor: $user);

            $revoked = $this->sessions->revokeAll($user);

            if ($revoked['devices'] + $revoked['sessions'] > 0) {
                Audit::record(MemberSecurityEvent::LogoutAll->value, $user, after: $revoked, actor: $user);
            }
        });

        if (! $verified) {
            throw $this->invalid();
        }

        /** @var User $user */
        return $this->signIn->begin($user, $device, $request);
    }

    private function invalid(): ApiException
    {
        return new ApiException(ErrorCode::InvalidCode, errors: ['code' => [ErrorCode::InvalidCode->message()]]);
    }
}
