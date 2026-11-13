<?php

namespace App\Http\Controllers\Api\V1\Events;

use App\Enums\ErrorCode;
use App\Enums\RsvpStatus;
use App\Enums\UserStatus;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Events\AttendeeListRequest;
use App\Http\Resources\V1\EventAttendeeResource;
use App\Models\EventRsvp;
use App\Models\User;
use App\Services\Discover\VisibleBuilds;
use App\Services\Events\Rsvps;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * EVT-04 Teilnehmer (privacy-respecting): members see going members who are publicly visible, findable (users.discoverable) and not
 * blocked either way; nobody on a sample event. The organiser sees every answer (going, interested, waitlist) with its time and can take
 * a member off the list (EVT-06).
 */
class AttendeeController extends Controller
{
    use FindsEvents;

    /**
     * List attendees.
     *
     * Members only. Going members by username; the organiser sees every answer newest first and filters by `status`.
     */
    public function index(AttendeeListRequest $request, string $slug, VisibleBuilds $builds): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();
        $event = $this->findEvent($slug, $user);
        $organiser = $event->isOrganisedBy($user);
        $status = $organiser ? $request->validated('status') : RsvpStatus::Going->value;

        $query = EventRsvp::query()->where('event_rsvps.event_id', $event->id)->whereNull('event_rsvps.removed_at')
            ->when(is_string($status), fn (Builder $q) => $q->where('event_rsvps.status', $status))
            ->whereHas('user', fn (Builder $member) => $member->whereNull('users.deleted_at')->where('users.status', UserStatus::Active->value)
                ->whereNotNull('users.email_verified_at')->whereNotNull('users.username')
                ->when(! $organiser, fn (Builder $q) => $q->where('users.discoverable', true))
                ->when(! $builds->samplesVisible(), fn (Builder $q) => $q->where('users.is_sample', false)))
            ->with('user.avatar');

        // 09 §8.19: no invented attendees on a sample event, for anybody but its organiser.
        if ($event->is_sample && ! $organiser) {
            $query->whereRaw('1 = 0');
        }

        $builds->withoutBlocks($query->getQuery(), $user, 'event_rsvps.user_id');
        // Security review L1: the cursor of a list ordered by answer time would carry the answer times the list hides from members, so
        // members page through usernames (shown anyway); only the organiser's list runs newest answer first.
        $query = $organiser
            ? $query->orderByDesc('event_rsvps.status_at')->orderByDesc('event_rsvps.id')
            : $query->join('users as attendee', 'attendee.id', '=', 'event_rsvps.user_id')->select(['event_rsvps.*', 'attendee.username as username'])
                ->orderBy('attendee.username');
        $page = $query->cursorPaginate($request->pageSize())->withQueryString();

        foreach ($page->items() as $rsvp) {
            $rsvp->setAttribute('show_time', $organiser);
        }

        return EventAttendeeResource::collection($page);
    }

    /**
     * Take a member off the list.
     *
     * The organiser (EVT-06). Silent for the member; they cannot answer again. A going member's spot goes to the waitlist. Answers 204.
     */
    public function destroy(Request $request, string $slug, string $username, Rsvps $rsvps): Response
    {
        /** @var User $user */
        $user = $request->user();
        $event = $this->organisedEvent($slug, $user);
        $member = User::query()->where('username', mb_strtolower($username))->first();

        if (! $member instanceof User || ! $rsvps->remove($event, $member)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return response()->noContent();
    }
}
