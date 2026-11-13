<?php

namespace App\Actions\Auth\Passwordless;

use App\Enums\LoginPurpose;
use App\Mail\AccountClosingMail;
use App\Mail\EmailCodeMail;
use App\Models\User;
use App\Services\Auth\AuthMailer;
use App\Services\Auth\EmailCodes;
use App\Support\Auth\EmailCodeStarted;
use Illuminate\Http\Request;

/**
 * AUTH-12 → POST auth/email/start (09 §8.1). Always 202 {attempt_id, resend_after}: the same body, the same queries and at least the same
 * duration whether or not the address has an account. A known address gets the sign-in code, an unknown one the code that creates the
 * account at verify, a closed one (deletion pending) the account-closing notice instead of a code. Mails leave after the response
 * (ADR-130). Within the cooldown, above 5 codes an hour or during a lock nothing is sent.
 */
class StartEmailSignIn
{
    public function __construct(
        private readonly EmailCodes $codes,
        private readonly AuthMailer $mailer,
    ) {}

    public function handle(string $email, string $attemptId, ?string $locale, ?string $platform, Request $request): EmailCodeStarted
    {
        $started = hrtime(true);
        $locale ??= app()->getLocale();

        $user = User::withTrashed()->where('email', $email)->first();
        $issued = $this->codes->issue($email, $attemptId, LoginPurpose::SignIn, $user?->id, $locale, $platform);

        if ($issued !== null) {
            $closed = $user !== null && ($user->isPendingDeletion() || $user->trashed());
            $userLocale = $user?->getAttribute('locale');

            $this->mailer->sendLater(
                $email,
                is_string($userLocale) ? $userLocale : $locale,
                $closed ? new AccountClosingMail : new EmailCodeMail(LoginPurpose::SignIn, $issued->code, $issued->magicToken, newAccount: $user === null),
            );
        }

        $this->pad($started);

        return new EmailCodeStarted($attemptId, $this->codes->resendAfter($email, LoginPurpose::SignIn));
    }

    /**
     * Not in the spec: a floor under the duration, so the few milliseconds of a mail object or a row lock say nothing.
     */
    private function pad(int|float $started): void
    {
        $elapsedUs = (int) ((hrtime(true) - $started) / 1000);
        $floorUs = config()->integer('speedclub.email_code.min_response_ms') * 1000;

        if ($elapsedUs < $floorUs) {
            usleep($floorUs - $elapsedUs);
        }
    }
}
