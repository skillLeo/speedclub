<?php

namespace App\Mail;

/**
 * The daily e-mail digest of unread messages (02_PRODUCT_SPEC §7, opt-in `new_message.email_digest`). A count only: never a name, a
 * message text or a photo (ADR-035, ADR-125).
 */
class MessageDigestMail extends AuthMail
{
    public function __construct(public readonly int $conversations) {}

    protected function subjectLine(): string
    {
        return (string) __('messaging.digest.subject');
    }

    protected function heading(): string
    {
        return (string) __('messaging.digest.heading');
    }

    protected function lines(): array
    {
        return [trans_choice('messaging.digest.intro', $this->conversations, ['count' => $this->conversations])];
    }

    protected function actions(): array
    {
        return [['label' => (string) __('messaging.digest.action'), 'url' => $this->url('/app/messages')]];
    }

    protected function note(): string
    {
        return (string) __('messaging.digest.note');
    }
}
