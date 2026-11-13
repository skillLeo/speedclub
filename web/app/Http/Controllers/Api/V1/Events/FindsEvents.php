<?php

namespace App\Http\Controllers\Api\V1\Events;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Event;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * Events are found by slug, and one the reader may not see answers exactly like a missing one: 404 event_unavailable (EventPolicy::view).
 */
trait FindsEvents
{
    protected function findEvent(string $slug, ?User $viewer): Event
    {
        $event = Event::query()->with('organiser')->where('slug', mb_strtolower($slug))->first();

        if (! $event instanceof Event || ! Gate::forUser($viewer)->allows('view', $event)) {
            throw new ApiException(ErrorCode::EventUnavailable);
        }

        return $event;
    }

    /**
     * An event the member organises: 404 when they cannot see it, 403 when it is somebody else's.
     */
    protected function organisedEvent(string $slug, User $user, string $ability = 'update'): Event
    {
        $event = $this->findEvent($slug, $user);
        Gate::forUser($user)->authorize($ability, $event);

        return $event;
    }
}
