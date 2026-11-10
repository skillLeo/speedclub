<?php

namespace App\Mail;

use App\Support\DisplayDate;
use Carbon\CarbonImmutable;

/**
 * SET-12: the signed link to the ZIP, valid 7 days. Sent from the queued export job.
 */
class DataExportReadyMail extends AuthMail
{
    public function __construct(
        public readonly string $downloadUrl,
        public readonly CarbonImmutable $expiresAt,
    ) {}

    protected function subjectLine(): string
    {
        return (string) __('mail.export.subject');
    }

    protected function heading(): string
    {
        return (string) __('mail.export.heading');
    }

    protected function lines(): array
    {
        return [
            (string) __('mail.export.intro'),
            (string) __('mail.export.valid', ['date' => DisplayDate::format($this->expiresAt)]),
            (string) __('mail.export.ends'),
        ];
    }

    protected function actions(): array
    {
        return [['label' => (string) __('mail.export.action'), 'url' => $this->downloadUrl]];
    }

    protected function note(): string
    {
        return (string) __('mail.export.note', ['support' => SupportAddress::get()]);
    }
}
