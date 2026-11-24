<?php

namespace App\Actions\Account;

use App\Enums\LoginPurpose;
use App\Mail\EmailCodeMail;
use App\Models\User;
use App\Services\Auth\AuthMailer;
use App\Services\Auth\EmailCodes;

/**
 * WEB-05 /konto-loeschen/code (client round 6, L3): the 6-digit code that proves the mailbox where there is no password to prove (Auth 2.0
 * accounts), purpose account_deletion, through the same EmailCodes as every e-mail code: 10 minutes, single use, HMAC at rest, 5 wrong
 * tries per code, 5 codes an hour and the 30 → 60 → 120 s cooldowns per address, the 15-minute lock after 10 failures.
 *
 * Enumeration-safe: every address takes the same path (one lookup, one code row, the same floor under the duration); only an open account
 * gets the mail, after the response (ADR-130). An account with a password may use it too: whoever holds the mailbox can reset the
 * password anyway, so the code proves no less.
 */
class StartAccountDeletionCode
{
    public function __construct(
        private readonly EmailCodes $codes,
        private readonly AuthMailer $mailer,
    ) {}

    /**
     * 0 when the attempt now holds a fresh code, otherwise the seconds until the address may ask again (cooldown, hourly limit or lock;
     * the same for every address, account or not).
     */
    public function handle(string $email, string $attemptId, string $locale): int
    {
        $started = hrtime(true);

        $user = User::query()->where('email', $email)->first();
        $open = $user !== null && ! $user->isPendingDeletion();
        $issued = $this->codes->issue($email, $attemptId, LoginPurpose::AccountDeletion, $open ? $user->id : null, $locale);

        if ($issued !== null && $open) {
            $userLocale = $user->getAttribute('locale');
            $this->mailer->sendLater($email, is_string($userLocale) ? $userLocale : $locale, new EmailCodeMail(LoginPurpose::AccountDeletion, $issued->code));
        }

        $wait = $issued === null ? max(1, $this->codes->resendAfter($email, LoginPurpose::AccountDeletion)) : 0;
        $this->pad($started);

        return $wait;
    }

    /**
     * Not in the spec: a floor under the duration, as in StartEmailSignIn, so the few milliseconds of a mail object say nothing.
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
