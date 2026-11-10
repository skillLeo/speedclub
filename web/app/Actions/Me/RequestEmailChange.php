<?php

namespace App\Actions\Me;

use App\Enums\MemberSecurityEvent;
use App\Enums\VerificationPurpose;
use App\Mail\EmailChangeAttemptMail;
use App\Mail\EmailChangeCodeMail;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\AuthMailer;
use App\Services\Auth\Reauthentication;
use App\Services\Auth\VerificationCodes;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

/**
 * SET-03 step 1. The same 202 whether or not the new address has an account. A free address gets a 6-digit code (purpose
 * email_change, ADR-134 budget). A taken one gets no code; its owner is told someone tried (bounded per address), and the confirm then
 * answers that the address cannot be used. The code row keeps the new address in verification_codes.email until it is confirmed.
 */
class RequestEmailChange
{
    public function __construct(
        private readonly Reauthentication $reauth,
        private readonly VerificationCodes $codes,
        private readonly AuthMailer $mailer,
    ) {}

    public function handle(User $user, string $email, string $password, ?string $code = null): int
    {
        $this->reauth->password($user, $password);
        // With two-factor on, the address also needs a current code (SEC-P2-07).
        $this->reauth->secondFactorForChange($user, $code);

        if ($email === $user->email) {
            throw ValidationException::withMessages(['email' => [(string) __('settings.email.same')]]);
        }

        $owner = User::withTrashed()->where('email', $email)->first();
        // Issued in both cases, so the cooldown, the budget and the work are the same. A taken address never receives its code.
        $code = $this->codes->issue($user, VerificationPurpose::EmailChange, email: $email);

        if ($code !== null) {
            Audit::record(MemberSecurityEvent::EmailChangeRequested->value, $user, actor: $user);

            if ($owner === null) {
                $this->mailer->sendLater($email, $this->locale($user), new EmailChangeCodeMail($code));
            } else {
                $this->notifyOwner($owner);
            }
        }

        return config()->integer('speedclub.verification.resend_cooldown_seconds');
    }

    private function notifyOwner(User $owner): void
    {
        $key = 'email-change-attempt:'.hash('sha256', $owner->email);

        if (RateLimiter::tooManyAttempts($key, config()->integer('speedclub.verification.max_codes_per_hour'))) {
            return;
        }

        RateLimiter::hit($key, 3600);

        $this->mailer->sendLater($owner->email, $this->locale($owner), new EmailChangeAttemptMail);
    }

    private function locale(User $user): string
    {
        $locale = $user->getAttribute('locale');

        return is_string($locale) ? $locale : app()->getLocale();
    }
}
