<?php

namespace App\Mail;

/**
 * M3.4 (ADM-26): the team's reply to a WEB-10 contact message, to the address the guest gave. Members read replies in the app (SET-15).
 * The reply text is the only content; internal notes are never sent.
 */
class SupportReplyMail extends AuthMail
{
    public function __construct(public readonly string $reference, public readonly string $body) {}

    protected function subjectLine(): string
    {
        return (string) __('moderation.mail.support_reply.subject', ['reference' => $this->reference]);
    }

    protected function heading(): string
    {
        return (string) __('moderation.mail.support_reply.heading');
    }

    protected function lines(): array
    {
        return [
            (string) __('moderation.mail.support_reply.intro', ['reference' => $this->reference]),
            ...array_values(array_filter(preg_split('/\R{2,}/u', trim($this->body)) ?: [], fn (string $line): bool => trim($line) !== '')),
        ];
    }

    protected function note(): string
    {
        return (string) __('moderation.mail.support_reply.note', ['reference' => $this->reference]);
    }
}
