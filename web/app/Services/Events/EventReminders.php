<?php

namespace App\Services\Events;

use App\Enums\EventStatus;
use App\Enums\RsvpStatus;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Notifications\Notifier;
use Carbon\CarbonImmutable;

/**
 * Reminders 24 h and 2 h before the start (09 §8.7), for going members, run by events:reminders every five minutes. An event is marked
 * (reminded_24h_at, reminded_2h_at) once all its going members were told; a run that reaches the time budget stops and the next one
 * continues, and Notifier's one row per event, kind and start tells nobody twice. An event created or moved inside the 24-hour window
 * gets only the 2-hour reminder; one that starts in less than two hours gets none.
 */
class EventReminders
{
    public function __construct(
        private readonly Notifier $notifier,
        private readonly FeatureFlags $flags,
    ) {}

    /**
     * @return int|null members reminded, null while the events flag is off
     */
    public function run(?CarbonImmutable $now = null): ?int
    {
        if (! $this->flags->enabled('events')) {
            return null;
        }

        $now ??= CarbonImmutable::now();
        $deadline = microtime(true) + config()->integer('speedclub.events.reminder_job_seconds');
        $sent = 0;

        foreach (['2h' => 2, '24h' => 24] as $kind => $hours) {
            $column = 'reminded_'.$kind.'_at';
            $events = Event::query()->with('organiser')
                ->where('status', EventStatus::Published->value)
                ->whereNull('removed_at')
                ->whereNull($column)
                ->where('starts_at', '>', $now)
                ->where('starts_at', '<=', $now->addHours($hours))
                ->orderBy('starts_at')
                ->limit(200)
                ->get();

            foreach ($events as $event) {
                // The 24-hour reminder of an event that starts within two hours would arrive with the 2-hour one: skip it.
                if ($kind === '24h' && $event->starts_at !== null && $event->starts_at->lessThanOrEqualTo($now->addHours(2))) {
                    $event->forceFill([$column => $now])->save();

                    continue;
                }

                [$count, $done] = $this->remind($event, $kind, $deadline);
                $sent += $count;

                if (! $done) {
                    return $sent;
                }

                $event->forceFill([$column => $now])->save();
            }
        }

        return $sent;
    }

    /**
     * @return array{0: int, 1: bool} members told, whether every going member was reached
     */
    private function remind(Event $event, string $kind, float $deadline): array
    {
        $sent = 0;
        $after = null;

        do {
            $rsvps = EventRsvp::query()->where('event_id', $event->id)->where('status', RsvpStatus::Going->value)->whereNull('removed_at')
                ->when($after !== null, fn ($query) => $query->where('id', '>', $after))
                ->orderBy('id')->limit(100)->get();
            $members = User::query()->whereKey($rsvps->pluck('user_id')->all())->get()->keyBy('id');

            foreach ($rsvps as $rsvp) {
                $member = $members->get($rsvp->user_id);

                if ($member instanceof User && $this->notifier->eventReminder($member, $event, $kind) !== null) {
                    $sent++;
                }

                $after = $rsvp->id;
            }

            if (microtime(true) > $deadline) {
                return [$sent, $rsvps->count() < 100];
            }
        } while ($rsvps->count() === 100);

        return [$sent, true];
    }
}
