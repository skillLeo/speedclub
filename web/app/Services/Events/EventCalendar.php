<?php

namespace App\Services\Events;

use App\Enums\EventStatus;
use App\Models\Event;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;

/**
 * The calendar file of an event (09 §8.7, RFC 5545): `/e/{slug}.ics` for everybody with the city only when the place is after_rsvp,
 * and a signed link per member (`?member=…&signature=…`) that carries the exact place while that member is still going — checked when
 * the file is fetched, so a link handed on or kept after withdrawing falls back to the city. Times in UTC, so no VTIMEZONE is needed.
 */
class EventCalendar
{
    public const ROUTE = 'public.event.ics';

    /**
     * The URL for "In Kalender": signed for $member (the organiser or a going member of an after_rsvp event), else the public file.
     */
    public function urlFor(Event $event, ?User $member): string
    {
        if ($member === null || EventLocation::exactFor($event, null)) {
            return route(self::ROUTE, ['slug' => $event->slug]);
        }

        $until = ($event->ends_at ?? now())->addDays(config()->integer('speedclub.events.calendar_link_days_after'));

        return URL::temporarySignedRoute(self::ROUTE, $until->isFuture() ? $until : now()->addHour(), ['slug' => $event->slug, 'member' => $member->id]);
    }

    public function ics(Event $event, bool $exact): string
    {
        $location = EventLocation::present($event, $exact);
        $place = $exact
            ? implode(', ', array_filter([$location['venue_name'], $location['street'], trim(($location['postcode'] ?? '').' '.($location['city'] ?? ''))]))
            : (string) ($location['city'] ?? '');
        $url = url('/e/'.$event->slug);
        $description = Str::limit(trim((string) $event->getAttribute('description')), 800, '…');

        $lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//SPEED CLUB//Treffen//DE',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'BEGIN:VEVENT',
            'UID:'.$event->id.'@'.(parse_url(config()->string('app.url'), PHP_URL_HOST) ?: 'speedclub'),
            'DTSTAMP:'.$this->time($event->updated_at ?? now()),
            'DTSTART:'.$this->time($event->starts_at ?? now()),
            'DTEND:'.$this->time($event->ends_at ?? $event->starts_at ?? now()),
            'SUMMARY:'.$this->text($event->title),
            'DESCRIPTION:'.$this->text(trim($description."\n\n".$url)),
            'LOCATION:'.$this->text($place),
            'URL:'.$url,
            'STATUS:'.($event->status === EventStatus::Cancelled ? 'CANCELLED' : 'CONFIRMED'),
        ];

        if ($exact && $location['lat'] !== null && $location['lng'] !== null) {
            $lines[] = sprintf('GEO:%.6F;%.6F', $location['lat'], $location['lng']);
        }

        $lines[] = 'END:VEVENT';
        $lines[] = 'END:VCALENDAR';

        return implode("\r\n", array_map($this->fold(...), $lines))."\r\n";
    }

    private function time(\DateTimeInterface $at): string
    {
        return CarbonImmutable::instance($at)->utc()->format('Ymd\THis\Z');
    }

    /**
     * TEXT value escaping (RFC 5545 §3.3.11).
     */
    private function text(string $value): string
    {
        return str_replace(['\\', ';', ',', "\r\n", "\n", "\r"], ['\\\\', '\;', '\\,', '\\n', '\\n', ''], $value);
    }

    /**
     * Lines longer than 75 octets continue on the next line after a space, never inside a UTF-8 character.
     */
    private function fold(string $line): string
    {
        $out = '';
        $current = '';

        foreach (mb_str_split($line) as $char) {
            if (strlen($current) + strlen($char) > 75) {
                $out .= $current."\r\n ";
                $current = '';
            }

            $current .= $char;
        }

        return $out.$current;
    }
}
