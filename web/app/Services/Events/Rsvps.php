<?php

namespace App\Services\Events;

use App\Enums\ErrorCode;
use App\Enums\RsvpStatus;
use App\Exceptions\ApiException;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\User;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;

/**
 * RSVPs with the waitlist (09 §8.7). Every change runs under the event's row lock, so two members cannot take the last spot at once:
 * "going" while the capacity has room, else the waitlist; "interested" never counts against it. When a going member leaves, switches
 * to interested or is taken off the list, or the organiser raises the capacity, fill() moves the longest-waiting members up (status_at
 * order) and tells them after the commit. Counts never include members the organiser took off the list.
 */
class Rsvps
{
    public function __construct(private readonly Notifier $notifier) {}

    /**
     * @throws ApiException 409 event_closed (cancelled, over, not published), 403 forbidden (taken off the list by the organiser)
     */
    public function set(User $user, Event $event, RsvpStatus $wanted): EventRsvp
    {
        return $this->locked($event, function (Event $locked) use ($user, $wanted): EventRsvp {
            if (! $locked->isOpen()) {
                throw new ApiException(ErrorCode::EventClosed);
            }

            $rsvp = EventRsvp::query()->where('event_id', $locked->id)->where('user_id', $user->id)->lockForUpdate()->first();

            if ($rsvp?->removed_at !== null) {
                throw new ApiException(ErrorCode::Forbidden);
            }

            $status = match (true) {
                $wanted === RsvpStatus::Interested => RsvpStatus::Interested,
                // Already going or waiting: stays (a waiting member keeps their place in the queue).
                $rsvp !== null && $rsvp->status !== RsvpStatus::Interested => $rsvp->status,
                $this->hasRoom($locked) => RsvpStatus::Going,
                default => RsvpStatus::Waitlist,
            };

            $before = $rsvp?->status;
            $rsvp ??= new EventRsvp(['event_id' => $locked->id, 'user_id' => $user->id]);

            if ($before !== $status) {
                $rsvp->forceFill(['status' => $status, 'status_at' => now()])->save();
            }

            if ($before === RsvpStatus::Going && $status !== RsvpStatus::Going) {
                $this->fill($locked);
            }

            return $rsvp;
        });
    }

    /**
     * Withdraws the member's answer; a no-op without one. A member the organiser took off the list keeps that row (so they cannot
     * answer again).
     */
    public function cancel(User $user, Event $event): void
    {
        $this->locked($event, function (Event $locked) use ($user): void {
            $rsvp = EventRsvp::query()->where('event_id', $locked->id)->where('user_id', $user->id)->lockForUpdate()->first();

            if ($rsvp === null || $rsvp->removed_at !== null) {
                return;
            }

            $wasGoing = $rsvp->status === RsvpStatus::Going;
            $rsvp->delete();

            if ($wasGoing) {
                $this->fill($locked);
            }
        });
    }

    /**
     * EVT-06: the organiser takes $member off the list. Silent for the member; their spot goes to the waitlist.
     */
    public function remove(Event $event, User $member): bool
    {
        return $this->locked($event, function (Event $locked) use ($member): bool {
            $rsvp = EventRsvp::query()->where('event_id', $locked->id)->where('user_id', $member->id)->lockForUpdate()->first();

            if ($rsvp === null || $rsvp->removed_at !== null) {
                return false;
            }

            $wasGoing = $rsvp->status === RsvpStatus::Going;
            $rsvp->forceFill(['removed_at' => now()])->save();

            if ($wasGoing) {
                $this->fill($locked);
            }

            return true;
        });
    }

    /**
     * Moves waiting members up while there is room. Call under the event's lock (inside locked()); promotions are told after commit.
     *
     * @return list<EventRsvp> the promoted answers
     */
    public function fill(Event $locked): array
    {
        if (! $locked->isOpen()) {
            return [];
        }

        $free = $locked->capacity === null ? PHP_INT_MAX : $locked->capacity - $this->going($locked);

        if ($free <= 0) {
            return [];
        }

        $waiting = EventRsvp::query()->where('event_id', $locked->id)->where('status', RsvpStatus::Waitlist)->whereNull('removed_at')
            ->orderBy('status_at')->orderBy('id')->limit(min($free, 500))->lockForUpdate()->get();
        $promoted = [];

        foreach ($waiting as $rsvp) {
            $rsvp->forceFill(['status' => RsvpStatus::Going, 'status_at' => now()])->save();
            $promoted[] = $rsvp;
        }

        if ($promoted !== []) {
            $ids = array_map(fn (EventRsvp $rsvp): string => $rsvp->user_id, $promoted);
            $eventId = $locked->id;

            DB::afterCommit(function () use ($ids, $eventId): void {
                $event = Event::query()->with('organiser')->find($eventId);

                if (! $event instanceof Event) {
                    return;
                }

                foreach (User::query()->whereKey($ids)->get() as $user) {
                    $this->notifier->eventPromoted($user, $event);
                }
            });
        }

        return $promoted;
    }

    /**
     * Runs $work in a transaction holding the event's row lock, with the fresh row.
     *
     * @template TResult
     *
     * @param  \Closure(Event): TResult  $work
     * @return TResult
     */
    public function locked(Event $event, \Closure $work): mixed
    {
        return DB::transaction(function () use ($event, $work): mixed {
            $locked = Event::query()->whereKey($event->id)->lockForUpdate()->firstOrFail();

            return $work($locked);
        }, 3);
    }

    /**
     * Going, interested and waitlist counts of each event (members taken off the list left out).
     *
     * @param  list<string>  $eventIds
     * @return array<string, array{going: int, interested: int, waitlist: int}>
     */
    public function counts(array $eventIds): array
    {
        $counts = array_fill_keys($eventIds, ['going' => 0, 'interested' => 0, 'waitlist' => 0]);

        if ($eventIds === []) {
            return $counts;
        }

        $rows = DB::table('event_rsvps')->whereIn('event_id', $eventIds)->whereNull('removed_at')
            ->groupBy('event_id', 'status')->selectRaw('event_id, status, count(*) as aggregate')->get();

        foreach ($rows as $row) {
            /** @var object{event_id: string, status: string, aggregate: int|string} $row */
            if (isset($counts[$row->event_id][$row->status])) {
                $counts[$row->event_id][$row->status] = (int) $row->aggregate;
            }
        }

        return $counts;
    }

    /**
     * The member's place on the waitlist (1 = next), or null when they are not waiting.
     */
    public function position(EventRsvp $rsvp): ?int
    {
        if ($rsvp->status !== RsvpStatus::Waitlist || $rsvp->removed_at !== null) {
            return null;
        }

        return 1 + EventRsvp::query()->where('event_id', $rsvp->event_id)->where('status', RsvpStatus::Waitlist)->whereNull('removed_at')
            ->where(fn ($query) => $query->where('status_at', '<', $rsvp->status_at)
                ->orWhere(fn ($same) => $same->where('status_at', $rsvp->status_at)->where('id', '<', $rsvp->id)))
            ->count();
    }

    private function hasRoom(Event $locked): bool
    {
        return $locked->capacity === null || $this->going($locked) < $locked->capacity;
    }

    private function going(Event $locked): int
    {
        return EventRsvp::query()->where('event_id', $locked->id)->where('status', RsvpStatus::Going)->whereNull('removed_at')->count();
    }
}
