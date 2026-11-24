<?php

namespace App\Services\Events;

use App\Enums\ErrorCode;
use App\Enums\EventStatus;
use App\Exceptions\ApiException;
use App\Models\Event;
use App\Models\EventCheckin;
use App\Models\EventCheckinCode;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Showcase\SampleContent;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * M5.6 check-in at the event (10 §4, m5.6-contract §5), behind `events` + `events.checkin`. The organiser's phone shows a six-character
 * code (as a QR of the check-in link) that rotates every checkin_code_ttl seconds; the code before stays valid checkin_code_grace seconds
 * longer, so a scan in flight still counts. Codes are compared case-insensitively and in constant time. Nothing about the place is read
 * or stored: being in front of the organiser is the proof. The window runs from an hour before the start to two hours after the end.
 */
class EventCheckins
{
    /** Seconds before expiry at which the organiser's screen asks for the next code (CheckinCodeResource.refresh_at). */
    public const REFRESH_LEAD = 30;

    public const FLAG = 'events.checkin';

    /** Crockford-like: no 0/O/1/I/L, so a code read out loud or typed from the screen is unambiguous. */
    public const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    public const LENGTH = 6;

    public function __construct(private readonly FeatureFlags $flags) {}

    public function enabled(): bool
    {
        return $this->flags->enabled('events') && $this->flags->enabled(self::FLAG);
    }

    /**
     * Check-in exists for this event at all: published (or cancelled, so a member can still take their "War dabei" off), not removed,
     * not a sample.
     */
    public function applies(Event $event): bool
    {
        return in_array($event->status, [EventStatus::Published, EventStatus::Cancelled], true)
            && $event->getAttribute('removed_at') === null
            && ! SampleContent::isSample($event);
    }

    public function opensAt(Event $event): ?CarbonImmutable
    {
        return $event->starts_at?->subMinutes(config()->integer('speedclub.events.checkin_opens_before_minutes'));
    }

    public function closesAt(Event $event): ?CarbonImmutable
    {
        return $event->effectiveEnd()?->addMinutes(config()->integer('speedclub.events.checkin_closes_after_minutes'));
    }

    public function isOpen(Event $event): bool
    {
        $opens = $this->opensAt($event);
        $closes = $this->closesAt($event);

        return $event->status === EventStatus::Published && $this->applies($event)
            && $opens !== null && $closes !== null && now()->between($opens, $closes);
    }

    /**
     * @throws ApiException 409 checkin_closed with meta.opens_at / meta.closes_at
     */
    public function assertOpen(Event $event): void
    {
        if (! $this->isOpen($event)) {
            throw new ApiException(ErrorCode::CheckinClosed, data: ['meta' => [
                'opens_at' => $this->opensAt($event)?->toIso8601String(),
                'closes_at' => $this->closesAt($event)?->toIso8601String(),
            ]]);
        }
    }

    public function of(Event $event, User $user): ?EventCheckin
    {
        return EventCheckin::query()->where('event_id', $event->id)->where('user_id', $user->id)->first();
    }

    /**
     * The organiser's current code: the newest one while it is younger than the ttl, otherwise a new one. Codes past their grace go.
     * Under the event's row lock, so two phones of the organiser asking at once share one code.
     */
    public function currentCode(Event $event): EventCheckinCode
    {
        $ttl = config()->integer('speedclub.events.checkin_code_ttl');
        $grace = config()->integer('speedclub.events.checkin_code_grace');

        return DB::transaction(function () use ($event, $ttl, $grace): EventCheckinCode {
            Event::query()->whereKey($event->id)->lockForUpdate()->value('id');
            EventCheckinCode::query()->where('event_id', $event->id)->where('expires_at', '<', now()->subSeconds($grace))->delete();

            // Rotate once less than REFRESH_LEAD is left (the app asks again at refresh_at), so the poll gets a new code instead of the
            // same one for its last 30 seconds; the previous code stays valid through its grace (review M5.6 nice-to-have).
            $current = EventCheckinCode::query()->where('event_id', $event->id)->where('expires_at', '>', now()->addSeconds(self::REFRESH_LEAD))
                ->orderByDesc('expires_at')->orderByDesc('id')->first();

            if ($current instanceof EventCheckinCode) {
                return $current;
            }

            $code = new EventCheckinCode;
            $code->forceFill([
                'event_id' => $event->id,
                'code' => self::generate(),
                'expires_at' => now()->addSeconds($ttl),
            ])->save();

            return $code;
        });
    }

    /**
     * Whether $input is a code of $event now: the current one, or the one before within its grace. Every candidate is compared with
     * hash_equals and none ends the loop early, so the time taken says nothing about how close a guess was.
     */
    public function matches(Event $event, string $input): bool
    {
        $given = self::normalise($input);
        $grace = config()->integer('speedclub.events.checkin_code_grace');
        $candidates = EventCheckinCode::query()->where('event_id', $event->id)
            ->where('expires_at', '>=', now()->subSeconds($grace))
            ->where('created_at', '<=', now())
            ->pluck('code')->all();

        $match = false;

        foreach ($candidates as $code) {
            $match = hash_equals(strtoupper((string) $code), $given) || $match;
        }

        return $match && strlen($given) === self::LENGTH;
    }

    /**
     * Capitals, no spaces or dashes (the app shows the code as "ABC DEF").
     */
    public static function normalise(string $input): string
    {
        return strtoupper((string) preg_replace('/[\s-]+/', '', $input));
    }

    public static function generate(): string
    {
        $code = '';
        $last = strlen(self::ALPHABET) - 1;

        for ($i = 0; $i < self::LENGTH; $i++) {
            $code .= self::ALPHABET[random_int(0, $last)];
        }

        return $code;
    }

    /**
     * The check-in link the QR carries; never anything about the member who scans it.
     */
    public function url(Event $event, string $code): string
    {
        return rtrim(config()->string('app.url'), '/').'/app/events/'.rawurlencode($event->slug).'/checkin?code='.rawurlencode($code);
    }

    /**
     * The detail's `checkin` (m5.6-contract §5.2).
     *
     * @return array{opens_at: string|null, closes_at: string|null, open: bool, mine: array{checked_in_at: string|null, profile_visible: bool}|null, count: int|null}
     */
    public function info(Event $event, ?User $viewer): array
    {
        $mine = $viewer === null ? null : $this->of($event, $viewer);

        return [
            'opens_at' => $this->opensAt($event)?->toIso8601String(),
            'closes_at' => $this->closesAt($event)?->toIso8601String(),
            'open' => $this->isOpen($event),
            'mine' => $mine === null ? null : ['checked_in_at' => $mine->checked_in_at->toIso8601String(), 'profile_visible' => $mine->profile_visible],
            'count' => $event->isOrganisedBy($viewer) ? EventCheckin::query()->where('event_id', $event->id)->count() : null,
        ];
    }
}
