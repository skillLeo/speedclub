<?php

namespace App\Actions\Auth;

use App\Enums\AuthNextStep;
use App\Enums\LegalDocumentKey;
use App\Enums\MemberSecurityEvent;
use App\Enums\SignupRef;
use App\Enums\VerificationPurpose;
use App\Mail\AccountClosingMail;
use App\Mail\AccountExistsMail;
use App\Mail\VerificationCodeMail;
use App\Models\User;
use App\Services\AppConfig\LegalDocuments;
use App\Services\Audit\Audit;
use App\Services\Auth\AuthMailer;
use App\Services\Auth\VerificationCodes;
use App\Support\Auth\NextStep;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;

/**
 * The same 202 whether or not the address has an account (decision of the lead on F1). The password is hashed on both
 * paths, because that is the slow part. A known address gets a notice with sign-in and reset links, or with what to expect
 * while the account waits for its hard delete, so the real owner learns what to do while nobody can probe addresses.
 * Registration issues no auth: that happens at verify.
 */
class RegisterMember
{
    public function __construct(
        private readonly VerificationCodes $codes,
        private readonly LegalDocuments $documents,
        private readonly AuthMailer $mailer,
    ) {}

    /**
     * @param  array{email: string, password: string, marketing_consent?: bool|null, locale?: string|null, ref?: string|null}  $input
     */
    public function handle(array $input): NextStep
    {
        $email = $input['email'];
        $hash = Hash::make($input['password']);
        $existing = User::withTrashed()->where('email', $email)->first();

        if ($existing !== null) {
            $this->notifyOwner($existing);
        } else {
            try {
                $this->create($input, $hash);
            } catch (UniqueConstraintViolationException) {
                // A parallel request won the race for this address.
                $winner = User::withTrashed()->where('email', $email)->first();

                if ($winner !== null) {
                    $this->notifyOwner($winner);
                }
            }
        }

        return NextStep::afterCodeRequest(AuthNextStep::VerifyEmail, $email);
    }

    /**
     * @param  array{email: string, password: string, marketing_consent?: bool|null, locale?: string|null, ref?: string|null}  $input
     */
    private function create(array $input, string $hash): void
    {
        $locale = $input['locale'] ?? app()->getLocale();
        $now = now();

        [$user, $code] = DB::transaction(function () use ($input, $hash, $locale, $now): array {
            $user = new User([
                'email' => $input['email'],
                'password' => $hash,
                'locale' => $locale,
                'terms_version' => $this->documents->current(LegalDocumentKey::Terms, $locale)?->version,
                'privacy_version' => $this->documents->current(LegalDocumentKey::Privacy, $locale)?->version,
                'consented_at' => $now,
                'marketing_consent_at' => ($input['marketing_consent'] ?? false) ? $now : null,
            ]);
            // ADR-216: where sign-up began, for "QR-Scans → Registrierungen". Counts only.
            $user->forceFill(['signup_ref' => SignupRef::tryFrom($input['ref'] ?? '')?->value]);
            $user->save();

            $code = $this->codes->issue($user, VerificationPurpose::EmailVerification);

            Audit::record(MemberSecurityEvent::Registered->value, $user, after: [
                'terms_version' => $user->getAttribute('terms_version'),
                'privacy_version' => $user->getAttribute('privacy_version'),
                'marketing_consent' => $user->getAttribute('marketing_consent_at') !== null,
            ], actor: $user);

            return [$user, $code];
        });

        if (is_string($code)) {
            $this->mailer->sendLater($user->email, $locale, new VerificationCodeMail($code, $user->email));
        }
    }

    /**
     * Bounded per address, so nobody can use this endpoint to flood a stranger's inbox. Silent, like everything here.
     */
    private function notifyOwner(User $owner): void
    {
        $key = 'account-exists:'.hash('sha256', $owner->email);

        if (RateLimiter::tooManyAttempts($key, config()->integer('speedclub.verification.max_codes_per_hour'))) {
            return;
        }

        RateLimiter::hit($key, 3600);

        $locale = $owner->getAttribute('locale');

        $this->mailer->sendLater(
            $owner->email,
            is_string($locale) ? $locale : app()->getLocale(),
            $owner->isDeactivated() ? new AccountClosingMail : new AccountExistsMail($owner->email),
        );
    }
}
