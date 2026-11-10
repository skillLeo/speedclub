<?php

namespace App\Mail;

/**
 * M3.2 (ADM-19): staff took the QR code of a member's build down (`revoked`) or issued a new one (`reissued`); the owner is told.
 */
class QrCodeChangedByStaffMail extends AuthMail
{
    /**
     * @param  'revoked'|'reissued'  $change
     */
    public function __construct(
        public readonly string $change,
        public readonly string $title,
    ) {}

    protected function subjectLine(): string
    {
        return (string) __('mail.qr_staff.'.$this->change.'.subject');
    }

    protected function heading(): string
    {
        return (string) __('mail.qr_staff.'.$this->change.'.heading');
    }

    protected function lines(): array
    {
        return [
            (string) __('mail.qr_staff.'.$this->change.'.intro', ['title' => $this->title]),
            (string) __('mail.qr_staff.'.$this->change.'.after'),
        ];
    }

    protected function note(): string
    {
        return (string) __('mail.qr_staff.note', ['support' => SupportAddress::get()]);
    }
}
