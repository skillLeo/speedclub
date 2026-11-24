<?php

namespace App\Http\Controllers\Api\V1\Events;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Events\CheckinListRequest;
use App\Http\Resources\V1\PublicCheckinCardResource;
use App\Models\EventCheckin;
use App\Services\Events\EventFeed;
use App\Services\Events\EventPresenter;
use App\Services\Garage\PublicMembers;
use App\Support\Viewer;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Collection;

class MemberCheckinsController extends Controller
{
    /**
     * List a member's check-ins.
     *
     * PROF-01/02 "War dabei": the events the member checked in to and shows on their profile, only once the event has ended (never live,
     * 10 §16), only events the reader may see in a list; newest check-in first, with the Berlin date of the check-in (`checked_in_on`),
     * never the time. A member who is not findable (SET privacy) shows nobody else their check-ins; a member the reader may not see
     * (blocks, unverified, suspended): 404 member_unavailable. Guests too.
     *
     * @unauthenticated
     */
    public function __invoke(CheckinListRequest $request, string $username, PublicMembers $members, EventFeed $feed, EventPresenter $presenter): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);
        $member = $members->visibleTo($viewer, $username) ?? throw new ApiException(ErrorCode::MemberUnavailable);
        $hidden = ! $member->is($viewer) && $member->getAttribute('discoverable') === false;

        $page = EventCheckin::query()->where('event_checkins.user_id', $member->id)
            ->where('event_checkins.profile_visible', true)
            ->whereIn('event_checkins.event_id', $feed->ended($viewer)->select('events.id'))
            ->when($hidden, fn ($query) => $query->whereRaw('1 = 0'))
            ->with('event.organiser')
            ->orderByDesc('event_checkins.checked_in_at')->orderByDesc('event_checkins.id')
            ->cursorPaginate($request->pageSize())->withQueryString();

        $presenter->prepare(Collection::make($page->items())->map(fn (EventCheckin $checkin) => $checkin->event), $viewer);

        return PublicCheckinCardResource::collection($page);
    }
}
