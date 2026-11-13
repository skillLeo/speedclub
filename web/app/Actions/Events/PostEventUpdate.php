<?php

namespace App\Actions\Events;

use App\Enums\ErrorCode;
use App\Enums\KeywordField;
use App\Exceptions\ApiException;
use App\Jobs\Events\NotifyEventUpdate;
use App\Models\Event;
use App\Models\EventUpdate;
use App\Models\User;
use App\Services\Rules\ContentScreen;
use Illuminate\Support\Facades\DB;

/**
 * EVT-06 "Update an Teilnehmer": a short note to everybody with an answer, while the event is open. Screened like the event's texts;
 * NotifyEventAttendees tells them after the commit (never the text in the push).
 */
class PostEventUpdate
{
    public function __construct(private readonly ContentScreen $screen) {}

    public function handle(User $user, Event $event, string $body): EventUpdate
    {
        $flags = $this->screen->screen(['body' => [KeywordField::EventText, $body]]);

        $update = DB::transaction(function () use ($user, $event, $body): EventUpdate {
            /** @var Event $locked */
            $locked = Event::query()->whereKey($event->id)->lockForUpdate()->firstOrFail();

            if (! $locked->isOpen()) {
                throw new ApiException(ErrorCode::EventClosed);
            }

            $update = EventUpdate::query()->create(['event_id' => $locked->id, 'author_id' => $user->id, 'body' => $body]);
            DB::afterCommit(fn () => NotifyEventUpdate::dispatch($locked->id, $update->id));

            return $update;
        });

        $this->screen->flagAfterCommit($flags, $event);

        return $update;
    }
}
