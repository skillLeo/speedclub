<?php

namespace App\Health\Checks;

use Spatie\Health\Checks\Check;
use Spatie\Health\Checks\Result;

/**
 * The mailer in use and the sender address (never host, user or password). In production a log or array mailer delivers nothing:
 * failed (the auth mails refuse to run on it, SEC-P1-27). Elsewhere the log mailer is the documented fallback: ok.
 */
class MailConfigCheck extends Check
{
    public function run(): Result
    {
        $mailer = (string) config('mail.default');
        $from = config('mail.from.address');
        $result = Result::make($mailer)->meta(['mailer' => $mailer, 'from_set' => is_string($from) && $from !== '']);

        if (app()->isProduction() && in_array($mailer, ['log', 'array'], true)) {
            return $result->failed("The $mailer mailer delivers no mail in production.");
        }

        if (! is_string($from) || $from === '') {
            return $result->warning('No sender address (MAIL_FROM_ADDRESS).');
        }

        return $result->ok();
    }
}
