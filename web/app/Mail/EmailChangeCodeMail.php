<?php

namespace App\Mail;

/**
 * SET-03: the code goes to the new address, which proves the member can read it before the account switches.
 */
class EmailChangeCodeMail extends AuthMail
{
    public function __construct(string $code)
    {
        $this->code = $code;
    }

    protected function subjectLine(): string
    {
        return (string) __('mail.email_change.subject', ['code' => $this->code]);
    }

    protected function heading(): string
    {
        return (string) __('mail.email_change.heading');
    }

    protected function lines(): array
    {
        return [(string) __('mail.email_change.intro')];
    }

    protected function note(): string
    {
        return (string) __('mail.code_note', ['minutes' => config()->integer('speedclub.verification.expires_minutes')]);
    }
}
