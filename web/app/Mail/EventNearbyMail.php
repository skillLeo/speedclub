<?php

namespace App\Mail;

use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Notifications\NotificationPrefs;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Mail\Factory;
use Illuminate\Contracts\Mail\Mailer;
use Illuminate\Mail\Mailables\Headers;
use Illuminate\Mail\SentMessage;

/**
 * M5.6 (m5.6-contract §6): the weekly e-mail "Neue Treffen in deiner Nähe", only when the member switched `event_nearby.email` on in SET-09
 * (off by default). Up to five meets with date, city and title, never the exact place (an after_rsvp place stays in the app; the digest
 * lists public meets only anyway). One click unsubscribes: the button and the List-Unsubscribe header (RFC 8058) carry a signed link. The
 * worker asks the e-mail switch again before it sends (send()).
 */
class EventNearbyMail extends AuthMail
{
    /**
     * @param  list<array{title: string, city: string, starts_at: string|null, slug: string}>  $events
     */
    public function __construct(
        public readonly array $events,
        public readonly int $total,
        public readonly string $unsubscribeUrl,
        public readonly ?string $region,
        public readonly ?string $memberId = null,
    ) {}

    /**
     * Review M5.6 NH (like the weekly recap's mail job): the mail is queued, so the member may have unsubscribed — or left, or the meets
     * were switched off — before the worker sends it. Asked again right before sending; then nothing goes out.
     *
     * @param  Factory|Mailer  $mailer
     */
    public function send($mailer): ?SentMessage
    {
        if ($this->memberId !== null && ! self::stillWanted($this->memberId)) {
            return null;
        }

        return parent::send($mailer);
    }

    public static function stillWanted(string $memberId): bool
    {
        $member = User::query()->find($memberId);

        return $member instanceof User && $member->isActive() && $member->hasVerifiedEmail()
            && (NotificationPrefs::for($member)['types']['event_nearby']['email'] ?? false) === true
            && app(FeatureFlags::class)->enabled('events');
    }

    protected function subjectLine(): string
    {
        return (string) __('notifications.event_nearby_mail.subject');
    }

    protected function heading(): string
    {
        return (string) __('notifications.event_nearby_mail.heading');
    }

    protected function lines(): array
    {
        $region = $this->region ?? (string) __('notifications.event_nearby_mail.region');
        $lines = [trans_choice('notifications.event_nearby_mail.intro', $this->total, ['count' => $this->total, 'region' => $region])];

        foreach ($this->events as $event) {
            $start = $event['starts_at'] === null ? null : CarbonImmutable::parse($event['starts_at'])->settings(['locale' => app()->getLocale()]);
            $lines[] = (string) __('notifications.event_nearby_mail.line', [
                'date' => $start?->isoFormat('dd, D. MMMM · HH:mm') ?? '',
                'city' => $event['city'],
                'title' => $event['title'],
            ]);
        }

        $more = $this->total - count($this->events);

        if ($more > 0) {
            $lines[] = trans_choice('notifications.event_nearby_mail.more', $more, ['count' => $more]);
        }

        return $lines;
    }

    protected function actions(): array
    {
        return [
            ['label' => (string) __('notifications.event_nearby_mail.action'), 'url' => $this->url('/app/events')],
            ['label' => (string) __('notifications.event_nearby_mail.unsubscribe'), 'url' => $this->unsubscribeUrl],
        ];
    }

    protected function note(): string
    {
        return (string) __('notifications.event_nearby_mail.note');
    }

    public function headers(): Headers
    {
        return new Headers(text: [
            'List-Unsubscribe' => '<'.$this->unsubscribeUrl.'>',
            'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click',
        ]);
    }
}
