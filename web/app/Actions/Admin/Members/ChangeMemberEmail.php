<?php

namespace App\Actions\Admin\Members;

use App\Enums\AdminMemberEvent;
use App\Enums\SecurityNotice;
use App\Enums\VerificationPurpose;
use App\Mail\SecurityNoticeMail;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\MemberRecord;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Auth\AuthMailer;
use App\Services\Auth\CredentialEpoch;
use App\Services\Auth\VerificationCodes;
use App\Services\Notifications\Notifier;
use App\Support\EmailAddress;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * ADM-10 "E-Mail ändern" (`members.edit`, recent password): support changes the address of a member who lost the old mailbox, only
 * after checking the member's identity ($identityVerified, the checkbox "Identität geprüft"). The address is normalised as at
 * registration (ADR-136/183); a taken address is refused. It counts as verified (the identity check is the proof), links sent to the
 * old address stop working (credentials epoch, SEC-P2-02), an open self-service change ends. Both addresses get the email_changed
 * notice in its staff wording. Audited with both addresses masked and their domains, never in full (the audit log is exported; the
 * member record shows the current one).
 *
 * @throws AuthorizationException|ValidationException
 */
class ChangeMemberEmail
{
    public function __construct(
        private readonly VerificationCodes $codes,
        private readonly Notifier $notifier,
        private readonly AuthMailer $mailer,
    ) {}

    public function handle(Staff $staff, User $member, string $email, bool $identityVerified, string $reason): User
    {
        StaffAtoms::ensure($staff, 'members.edit');

        if (! $identityVerified) {
            throw ValidationException::withMessages(['identity_verified' => [(string) __('validation.accepted', ['attribute' => 'identity_verified'])]]);
        }

        $email = EmailAddress::normalize($email);
        $previous = $member->email;

        if ($email === $previous) {
            throw ValidationException::withMessages(['email' => [(string) __('settings.email.same')]]);
        }

        try {
            DB::transaction(function () use ($staff, $member, $email, $previous, $reason): void {
                $locked = User::query()->whereKey($member->id)->lockForUpdate()->firstOrFail();

                if (User::withTrashed()->where('email', $email)->whereKeyNot($locked->id)->exists()) {
                    throw $this->unavailable();
                }

                $locked->forceFill([
                    'email' => $email,
                    'email_verified_at' => $locked->getAttribute('email_verified_at') ?? now(),
                    'remember_token' => Str::random(60),
                    'credentials_epoch' => CredentialEpoch::fresh(),
                ])->save();

                $this->codes->close($locked, VerificationPurpose::EmailChange);
                $member->setRawAttributes($locked->getAttributes(), true);

                // Masked addresses and their domains (review N-4): enough to trace a takeover through a support call in the chain,
                // without the addresses themselves in an exportable log.
                Audit::record(AdminMemberEvent::EmailChangedByStaff->value, $locked, before: [
                    'email_masked' => MemberRecord::maskEmail($previous),
                    'email_domain' => self::domain($previous),
                ], after: [
                    'email_masked' => MemberRecord::maskEmail($email),
                    'email_domain' => self::domain($email),
                    'identity_verified' => true,
                ], reason: trim($reason), actor: $staff);
            });
        } catch (UniqueConstraintViolationException) {
            throw $this->unavailable();
        }

        $this->notifier->security($member, SecurityNotice::EmailChanged, to: $previous, variant: 'staff');
        $locale = $member->getAttribute('locale');
        $this->mailer->sendLater($member->email, is_string($locale) ? $locale : app()->getLocale(), new SecurityNoticeMail(SecurityNotice::EmailChanged, variant: 'staff'));

        return $member;
    }

    private static function domain(string $email): string
    {
        $at = strrpos($email, '@');

        return $at === false ? '' : mb_strtolower(substr($email, $at + 1));
    }

    private function unavailable(): ValidationException
    {
        return ValidationException::withMessages(['email' => [(string) __('settings.email.unavailable')]]);
    }
}
