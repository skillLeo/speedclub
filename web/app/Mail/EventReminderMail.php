<?php

namespace App\Mail;

use Carbon\CarbonImmutable;

/**
 * M4.12 (09 §8.7): the e-mail of an event reminder 24 h or 2 h before the start, only when the member switched it on in SET-09
 * (`event_reminder.email`, off by default). The event's title and start; never the place (an after_rsvp place stays in the app).
 */
class EventReminderMail extends AuthMail
{
    public function __construct(
        public readonly string $title,
        public readonly string $kind,
        public readonly string $slug,
        public readonly ?CarbonImmutable $startsAt,
    ) {}

    protected function subjectLine(): string
    {
        return (string) __('notifications.event_reminder_mail.subject_'.($this->kind === '2h' ? '2h' : '24h'), ['title' => $this->title]);
    }

    protected function heading(): string
    {
        return (string) __('notifications.event_reminder_mail.heading');
    }

    protected function lines(): array
    {
        $start = $this->startsAt?->setTimezone(config()->string('speedclub.notifications.timezone'))->settings(['locale' => app()->getLocale()]);

        return [(string) __('notifications.event_reminder_mail.intro', [
            'title' => $this->title,
            'date' => $start?->isoFormat('dddd, D. MMMM') ?? '',
            'time' => $start?->format('H:i') ?? '',
        ])];
    }

    protected function actions(): array
    {
        return [['label' => (string) __('notifications.event_reminder_mail.action'), 'url' => $this->url('/app/events/'.$this->slug)]];
    }

    protected function note(): string
    {
        return (string) __('notifications.event_reminder_mail.note');
    }
}
