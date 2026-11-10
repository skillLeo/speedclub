<?php

namespace App\Actions\Me;

use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Enums\VerificationPurpose;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Models\VerificationCode;
use App\Services\Audit\Audit;
use App\Services\Auth\CredentialEpoch;
use App\Services\Auth\VerificationCodes;
use App\Services\Notifications\Notifier;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * SET-03 step 2. The code proves the new mailbox; the account switches, stays verified, and the previous address gets the security
 * mail with the support button (ADR-198). A taken address never switches: "Diese Adresse kann nicht verwendet werden." (proposed ADR:
 * this tells a member who knows their own password that an address has an account, as ADR-133 accepts for registration; each try
 * mails the owner and spends the member's code budget).
 */
class ConfirmEmailChange
{
    public function __construct(
        private readonly VerificationCodes $codes,
        private readonly Notifier $notifier,
    ) {}

    public function handle(User $user, string $code): User
    {
        $pending = $this->codes->pending($user, VerificationPurpose::EmailChange);
        $target = $pending?->getAttribute('email');

        if (! is_string($target)) {
            throw new ApiException(ErrorCode::InvalidCode, (string) __('settings.email.nothing_pending'), errors: ['code' => [(string) __('settings.email.nothing_pending')]]);
        }

        if ($this->taken($target, $user)) {
            $this->codes->close($user, VerificationPurpose::EmailChange);

            throw $this->unavailable();
        }

        $previous = $user->email;

        try {
            $done = $this->codes->consume($user, VerificationPurpose::EmailChange, $code, function (VerificationCode $row) use ($user): void {
                $address = (string) $row->getAttribute('email');

                if ($this->taken($address, $user)) {
                    throw $this->unavailable();
                }

                $user->forceFill([
                    'email' => $address,
                    'email_verified_at' => now(),
                    'remember_token' => Str::random(60),
                    // Links sent to the old address stop working (SEC-P2-02).
                    'credentials_epoch' => CredentialEpoch::fresh(),
                ])->save();

                Audit::record(MemberSecurityEvent::EmailChanged->value, $user, actor: $user);
            });
        } catch (UniqueConstraintViolationException) {
            throw $this->unavailable();
        }

        if (! $done) {
            throw new ApiException(ErrorCode::InvalidCode, errors: ['code' => [ErrorCode::InvalidCode->message()]]);
        }

        $this->notifier->security($user, SecurityNotice::EmailChanged, to: $previous);

        return $user;
    }

    private function taken(string $email, User $user): bool
    {
        return User::withTrashed()->where('email', $email)->whereKeyNot($user->getKey())->exists();
    }

    private function unavailable(): ValidationException
    {
        return ValidationException::withMessages(['email' => [(string) __('settings.email.unavailable')]]);
    }
}
