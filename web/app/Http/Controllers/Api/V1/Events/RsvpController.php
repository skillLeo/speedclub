<?php

namespace App\Http\Controllers\Api\V1\Events;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Events\RsvpRequest;
use App\Http\Resources\V1\EventRsvpStateResource;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\User;
use App\Services\Events\Rsvps;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * RSVP (09 §8.7, EVT-02 sticky bar): going ("Zusagen"; the waitlist when the capacity is full) or interested; withdraw any time.
 */
class RsvpController extends Controller
{
    use FindsEvents;

    /**
     * Answer an event.
     *
     * Idempotent: the same answer again changes nothing, and a member on the waitlist keeps their place. Needs a verified e-mail (403
     * email_not_verified); the organiser cannot answer (403); cancelled or over: 409 event_closed. A member the organiser took off the
     * list: 403 forbidden.
     */
    public function update(RsvpRequest $request, string $slug, Rsvps $rsvps): EventRsvpStateResource
    {
        /** @var User $user */
        $user = $request->user();
        $event = $this->findEvent($slug, $user);

        if ($event->isOrganisedBy($user)) {
            throw new ApiException(ErrorCode::Forbidden, (string) __('events.cannot_answer_own'));
        }

        Gate::authorize('rsvp', $event);
        $rsvp = $rsvps->set($user, $event, $request->status());

        return $this->state($event, $rsvp, $rsvps);
    }

    /**
     * Withdraw an answer.
     *
     * Any time, also after the event became invisible to the member; a going member's spot goes to the waitlist. Answers the state
     * (status null).
     */
    public function destroy(Request $request, string $slug, Rsvps $rsvps): EventRsvpStateResource
    {
        /** @var User $user */
        $user = $request->user();
        $event = Event::query()->with('organiser')->where('slug', mb_strtolower($slug))->first();
        $answered = $event instanceof Event && EventRsvp::query()->where('event_id', $event->id)->where('user_id', $user->id)->exists();

        if (! $event instanceof Event || (! $answered && ! Gate::forUser($user)->allows('view', $event))) {
            throw new ApiException(ErrorCode::EventUnavailable);
        }

        $rsvps->cancel($user, $event);

        return $this->state($event, null, $rsvps);
    }

    private function state(Event $event, ?EventRsvp $rsvp, Rsvps $rsvps): EventRsvpStateResource
    {
        $fresh = $event->fresh() ?? $event;

        return new EventRsvpStateResource([
            'event' => $fresh,
            'rsvp' => $rsvp?->fresh(),
            'counts' => $rsvps->counts([$fresh->id])[$fresh->id],
        ]);
    }
}
