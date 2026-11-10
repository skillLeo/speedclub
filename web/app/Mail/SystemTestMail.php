<?php

namespace App\Mail;

use App\Support\DisplayDate;

/**
 * ADM-50 "Test-E-Mail an mich": proves the mailer delivers, to the staff member's own address, in the members' mail layout.
 */
class SystemTestMail extends AuthMail
{
    public function __construct(public readonly string $mailerName) {}

    protected function subjectLine(): string
    {
        return (string) __('system.mail.test.subject');
    }

    protected function heading(): string
    {
        return (string) __('system.mail.test.heading');
    }

    protected function lines(): array
    {
        return [(string) __('system.mail.test.body', ['mailer' => $this->mailerName, 'date' => DisplayDate::format(now())])];
    }
}
