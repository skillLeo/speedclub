<?php

namespace App\Mail;

use App\Services\Notifications\NotificationTexts;

/**
 * M2.7 [SIG sig.hu_au_reminder] (02_PRODUCT_SPEC §7): the e-mail of the HU/AU reminder, only when the owner switched it on in SET-09
 * (`hu_au_reminder.email`, off by default). The vehicle's own title and the due month; nothing else of the account.
 */
class HuAuReminderMail extends AuthMail
{
    public function __construct(
        public readonly string $vehicleTitle,
        public readonly string $due,
        public readonly string $vehicleId,
    ) {}

    protected function subjectLine(): string
    {
        return (string) __('notifications.hu_au_mail.subject', ['vehicle' => $this->vehicleTitle, 'month' => $this->month()]);
    }

    protected function heading(): string
    {
        return (string) __('notifications.hu_au_mail.heading');
    }

    protected function lines(): array
    {
        return [(string) __('notifications.hu_au_mail.intro', ['vehicle' => $this->vehicleTitle, 'month' => $this->month()])];
    }

    protected function actions(): array
    {
        return [['label' => (string) __('notifications.hu_au_mail.action'), 'url' => $this->url('/app/garage/'.$this->vehicleId.'/specs')]];
    }

    protected function note(): string
    {
        return (string) __('notifications.hu_au_mail.note');
    }

    private function month(): string
    {
        return NotificationTexts::month($this->due, app()->getLocale());
    }
}
