<?php

namespace App\Mail;

use App\Services\Privacy\RetentionPolicy;

/**
 * Someone tried to register with the address of an account in its deletion window. Sign-in and reset do not work for such
 * an account, so this says what does: the address frees up when the hard delete has run.
 */
class AccountClosingMail extends AuthMail
{
    protected function subjectLine(): string
    {
        return (string) __('mail.closing.subject');
    }

    protected function heading(): string
    {
        return (string) __('mail.closing.heading');
    }

    protected function lines(): array
    {
        return [
            (string) __('mail.closing.intro', ['days' => app(RetentionPolicy::class)->value('accounts_hard_delete_days')]),
            (string) __('mail.closing.after'),
        ];
    }

    protected function note(): string
    {
        return (string) __('mail.closing.note');
    }
}
