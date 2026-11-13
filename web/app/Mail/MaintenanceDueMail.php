<?php

namespace App\Mail;

/**
 * M4.13 (09 §8.8, §8.17): the e-mail of a maintenance reminder, only when the owner switched e-mails on for "Fälligkeiten" in SET-09
 * (`hu_au_reminder.email`, off by default). The sentence of the push (NotificationTexts) and a link to MNT-01; nothing else of the account.
 */
class MaintenanceDueMail extends AuthMail
{
    public function __construct(
        public readonly string $vehicleTitle,
        public readonly string $sentence,
        public readonly string $vehicleId,
    ) {}

    protected function subjectLine(): string
    {
        return (string) __('notifications.maintenance_mail.subject', ['vehicle' => $this->vehicleTitle]);
    }

    protected function heading(): string
    {
        return (string) __('notifications.maintenance_mail.heading');
    }

    protected function lines(): array
    {
        return [$this->sentence];
    }

    protected function actions(): array
    {
        return [['label' => (string) __('notifications.maintenance_mail.action'), 'url' => $this->url('/app/garage/'.$this->vehicleId.'/maintenance')]];
    }

    protected function note(): string
    {
        return (string) __('notifications.maintenance_mail.note');
    }
}
