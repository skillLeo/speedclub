<?php

namespace App\Jobs\Events;

use App\Models\Event;
use App\Models\User;
use App\Services\Notifications\Notifier;

/**
 * The event was cancelled (by its organiser, staff or the organiser's account closure); one row per event and member. Whether staff
 * cancelled it is read from the event (cancelled_by_staff).
 */
class NotifyEventCancellation extends NotifyEventAttendees
{
    public function __construct(public readonly string $eventId, public readonly ?string $afterId = null) {}

    protected function eventKey(): string
    {
        return $this->eventId;
    }

    protected function cursor(): ?string
    {
        return $this->afterId;
    }

    protected function notify(Notifier $notifier, User $member, Event $event): void
    {
        $notifier->eventCancelled($member, $event, $event->getAttribute('cancelled_by_staff') === true);
    }

    protected function continueAfter(string $afterId): NotifyEventAttendees
    {
        return new self($this->eventId, $afterId);
    }
}
