<?php

namespace App\Mail;

use App\Support\DisplayDate;
use Carbon\CarbonInterface;

/**
 * ADM-39: the invite to the admin. The link carries the single-use token in its fragment (StaffInvites); it is valid 72 hours. After the
 * password the account enrols TOTP before anything else (ADM-03).
 */
class StaffInviteMail extends AuthMail
{
    public function __construct(public readonly string $name, public readonly string $link, public readonly CarbonInterface $expiresAt) {}

    protected function subjectLine(): string
    {
        return (string) __('team.mail.invite.subject');
    }

    protected function heading(): string
    {
        return (string) __('team.mail.invite.heading', ['name' => $this->name]);
    }

    protected function lines(): array
    {
        return [
            (string) __('team.mail.invite.intro'),
            (string) __('team.mail.invite.steps'),
        ];
    }

    protected function actions(): array
    {
        return [['label' => (string) __('team.mail.invite.action'), 'url' => $this->link]];
    }

    protected function note(): string
    {
        return (string) __('team.mail.invite.note', ['date' => DisplayDate::format($this->expiresAt)]);
    }
}
