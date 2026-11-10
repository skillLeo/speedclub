<?php

namespace App\Mail;

use App\Enums\SupportCategory;

/**
 * SET-15 and WEB-10: the receipt. It never repeats the message, which a stranger may have typed under somebody else's address.
 */
class SupportTicketReceivedMail extends AuthMail
{
    public function __construct(
        public readonly SupportCategory $category,
        public readonly string $reference,
    ) {}

    protected function subjectLine(): string
    {
        return (string) __('mail.support.subject');
    }

    protected function heading(): string
    {
        return (string) __('mail.support.heading');
    }

    protected function lines(): array
    {
        return [
            (string) __('mail.support.intro', ['category' => $this->category->label()]),
            (string) __('mail.support.reference', ['reference' => $this->reference]),
        ];
    }

    protected function note(): string
    {
        return (string) __('mail.support.note');
    }
}
