<?php

namespace App\Mail;

/**
 * ADR-238: an Owner reset the staff member's second factor with the approval of a second Owner. Sign-in now needs a new password through
 * the staff password reset (the mailbox is the proof), then a new authenticator (ADM-03). No link with a token: the reset page sends one.
 */
class StaffTwoFactorResetMail extends AuthMail
{
    public function __construct(public readonly string $name) {}

    protected function subjectLine(): string
    {
        return (string) __('team.mail.two_factor_reset.subject');
    }

    protected function heading(): string
    {
        return (string) __('team.mail.two_factor_reset.heading', ['name' => $this->name]);
    }

    protected function lines(): array
    {
        return [
            (string) __('team.mail.two_factor_reset.intro'),
            (string) __('team.mail.two_factor_reset.steps'),
        ];
    }

    protected function actions(): array
    {
        return [['label' => (string) __('team.mail.two_factor_reset.action'), 'url' => $this->url('/admin/forgot-password')]];
    }

    protected function note(): string
    {
        return (string) __('team.mail.two_factor_reset.note');
    }
}
