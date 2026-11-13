<?php

namespace App\Jobs\Events;

use App\Enums\RsvpStatus;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\User;
use App\Services\Notifications\Notifier;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Tells everybody with an answer to an event (going, interested, waitlist; not members the organiser took off the list) about an
 * organiser update, a change of time or place, or a cancellation (09 §8.7, §8.17). In slices by RSVP id within reminder_job_seconds; a
 * slice that runs out of time queues the rest. Notifier groups by update, change or event, so a retried slice tells nobody twice.
 * The subclasses carry ids only (GarageSecurityAuditTest): NotifyEventUpdate, NotifyEventChange, NotifyEventCancellation.
 */
abstract class NotifyEventAttendees implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 50;

    abstract protected function eventKey(): string;

    abstract protected function cursor(): ?string;

    abstract protected function notify(Notifier $notifier, User $member, Event $event): void;

    /**
     * The same job for the members after $afterId.
     */
    abstract protected function continueAfter(string $afterId): self;

    public function handle(Notifier $notifier): void
    {
        $event = Event::query()->with('organiser')->find($this->eventKey());

        if (! $event instanceof Event) {
            return;
        }

        $deadline = microtime(true) + config()->integer('speedclub.events.reminder_job_seconds');
        $after = $this->cursor();

        do {
            $rsvps = EventRsvp::query()->where('event_id', $event->id)->whereNull('removed_at')
                ->whereIn('status', [RsvpStatus::Going->value, RsvpStatus::Interested->value, RsvpStatus::Waitlist->value])
                ->when($after !== null, fn ($query) => $query->where('id', '>', $after))
                ->orderBy('id')->limit(100)->get();
            $members = User::query()->whereKey($rsvps->pluck('user_id')->all())->get()->keyBy('id');

            foreach ($rsvps as $rsvp) {
                $member = $members->get($rsvp->user_id);

                if ($member instanceof User) {
                    $this->notify($notifier, $member, $event);
                }

                $after = $rsvp->id;
            }

            if ($after !== null && $rsvps->count() === 100 && microtime(true) > $deadline) {
                dispatch($this->continueAfter($after));

                return;
            }
        } while ($rsvps->count() === 100);
    }
}
