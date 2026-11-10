<?php

namespace App\Mail;

/**
 * SET-03: another account tried to move to this address. The owner hears of it; the other account never switches.
 */
class EmailChangeAttemptMail extends AuthMail
{
    protected function subjectLine(): string
    {
        return (string) __('mail.email_change_attempt.subject');
    }

    protected function heading(): string
    {
        return (string) __('mail.email_change_attempt.heading');
    }

    protected function lines(): array
    {
        return [(string) __('mail.email_change_attempt.intro')];
    }

    protected function note(): string
    {
        return (string) __('mail.email_change_attempt.note', ['support' => SupportAddress::get()]);
    }
}
