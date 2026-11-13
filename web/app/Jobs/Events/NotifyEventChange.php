<?php

namespace App\Jobs\Events;

use App\Models\Event;
use App\Models\User;
use App\Services\Notifications\Notifier;

/**
 * The organiser changed the time or the place of a published event; $changeId is the moment of the change (ms). One row per event, updated
 * in place by later changes (Notifier::eventChanged, SEC-412-02).
 */
class NotifyEventChange extends NotifyEventAttendees
{
    public function __construct(public readonly string $eventId, public readonly string $changeId, public readonly ?string $afterId = null) {}

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
        $notifier->eventChanged($member, $event, $this->changeId);
    }

    protected function continueAfter(string $afterId): NotifyEventAttendees
    {
        return new self($this->eventId, $this->changeId, $afterId);
    }
}
