<?php

namespace App\Mail;

use App\Services\Engagement\RecapTexts;
use Illuminate\Mail\Mailables\Headers;

/**
 * M5.7 (10 §6.3, m5.7-contract §6.4): the weekly recap by e-mail, only when no push went out for it (D-1) and the member kept "per E-Mail"
 * on (default on). The week's numbers (never a zero, never a comparison, never who), one button to the statistics, and one click to stop
 * it: the unsubscribe button and the List-Unsubscribe header (RFC 8058) carry a signed link.
 */
class WeeklyRecapMail extends AuthMail
{
    /**
     * @param  array<string, int>  $payload
     */
    public function __construct(
        public readonly array $payload,
        public readonly string $unsubscribeUrl,
    ) {}

    protected function subjectLine(): string
    {
        return (string) __('notifications.weekly_recap_mail.subject');
    }

    protected function heading(): string
    {
        return (string) __('notifications.weekly_recap_mail.heading');
    }

    protected function lines(): array
    {
        return [(string) __('notifications.weekly_recap_mail.intro'), ...RecapTexts::parts($this->payload, app()->getLocale())];
    }

    protected function actions(): array
    {
        return [
            ['label' => (string) __('notifications.weekly_recap_mail.action'), 'url' => $this->url('/app/insights')],
            ['label' => (string) __('notifications.weekly_recap_mail.unsubscribe'), 'url' => $this->unsubscribeUrl],
        ];
    }

    protected function note(): string
    {
        return (string) __('notifications.weekly_recap_mail.note');
    }

    public function headers(): Headers
    {
        return new Headers(text: [
            'List-Unsubscribe' => '<'.$this->unsubscribeUrl.'>',
            'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click',
        ]);
    }
}
