<?php

namespace App\Jobs\Events;

use App\Models\Event;
use App\Models\EventUpdate;
use App\Models\User;
use App\Services\Notifications\Notifier;

/**
 * EVT-06: the organiser posted an update; one row per update and member.
 */
class NotifyEventUpdate extends NotifyEventAttendees
{
    public function __construct(public readonly string $eventId, public readonly string $updateId, public readonly ?string $afterId = null) {}

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
        $update = EventUpdate::query()->find($this->updateId);

        if ($update instanceof EventUpdate) {
            $notifier->eventUpdate($member, $event, $update);
        }
    }

    protected function continueAfter(string $afterId): NotifyEventAttendees
    {
        return new self($this->eventId, $this->updateId, $afterId);
    }
}
