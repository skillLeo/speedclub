<?php

namespace App\Actions\Events\Checkin;

use App\Enums\CheckinMethod;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\RateLimits;
use App\Models\Event;
use App\Models\EventCheckin;
use App\Models\User;
use App\Services\Events\EventCheckins;
use App\Services\Progress\XpHooks;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\RateLimiter;

/**
 * M5.6 "Einchecken" (EVT-07 / EVT-02, m5.6-contract §5.3): a member in front of the organiser enters or scans the current code. Already
 * checked in answers with the existing check-in (the route says 200 instead of 201), so a retry or a second scan changes nothing. The RSVP
 * is not touched: a walk-in stays without "Zusage" and takes no capacity. No location, device or IP is read or stored.
 *
 * Wrong codes count per member and event: after checkin_wrong_codes_max in an hour, 429 with Retry-After (guessing a six-character code
 * of a 31-letter alphabet is then hopeless).
 *
 * A new check-in earns its XP (XpHooks::eventCheckedIn, once per event; "War bei 5 Treffen" reads that ledger, SEC-P5-14).
 */
class CheckInToEvent
{
    public function __construct(
        private readonly EventCheckins $checkins,
        private readonly XpHooks $xp,
    ) {}

    /**
     * @return array{0: EventCheckin, 1: bool} the check-in, and whether this call created it
     */
    public function handle(User $user, Event $event, string $code, bool $profileVisible): array
    {
        $existing = $this->checkins->of($event, $user);

        if ($existing instanceof EventCheckin) {
            return [$existing, false];
        }

        $this->checkins->assertOpen($event);

        $key = 'checkin-codes:'.$event->id.':'.$user->id;
        $max = config()->integer('speedclub.events.checkin_wrong_codes_max');

        if (RateLimiter::tooManyAttempts($key, $max)) {
            throw RateLimits::tooMany('checkin_codes', ['Retry-After' => RateLimiter::availableIn($key)]);
        }

        if (! $this->checkins->matches($event, $code)) {
            RateLimiter::hit($key, 3600);

            throw new ApiException(ErrorCode::CheckinCodeInvalid, errors: ['code' => [ErrorCode::CheckinCodeInvalid->message()]]);
        }

        $checkin = new EventCheckin;
        $checkin->forceFill([
            'event_id' => $event->id,
            'user_id' => $user->id,
            'checked_in_at' => now(),
            'profile_visible' => $profileVisible,
            'method' => CheckinMethod::Code,
        ]);

        try {
            $checkin->save();
        } catch (UniqueConstraintViolationException) {
            // A parallel request of the same member won the race: theirs is the check-in.
            return [$this->checkins->of($event, $user) ?? $checkin, false];
        }

        $this->xp->eventCheckedIn($user, $event);

        return [$checkin, true];
    }
}
