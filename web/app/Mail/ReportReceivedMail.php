<?php

namespace App\Mail;

use App\Enums\ReportReason;
use App\Support\Moderation\ModerationText;

/**
 * WEB-09: the confirmation of receipt to the address a notifier gave (Art. 16(4) DSA). Names the reference, the reported page and the
 * reason, nothing of the explanation.
 */
class ReportReceivedMail extends AuthMail
{
    public function __construct(
        public readonly string $reference,
        public readonly string $url,
        public readonly ReportReason $reason,
    ) {}

    protected function subjectLine(): string
    {
        return (string) __('moderation.mail.received.subject');
    }

    protected function heading(): string
    {
        return (string) __('moderation.mail.received.heading');
    }

    protected function lines(): array
    {
        return [
            (string) __('moderation.mail.received.intro', ['url' => $this->url, 'reason' => ModerationText::reason($this->reason)]),
            (string) __('moderation.mail.received.next'),
            (string) __('moderation.mail.received.reference', ['reference' => $this->reference]),
        ];
    }

    protected function note(): string
    {
        return (string) __('moderation.mail.received.note');
    }
}
