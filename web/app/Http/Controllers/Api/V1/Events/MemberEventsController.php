<?php

namespace App\Http\Controllers\Api\V1\Events;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Events\MemberEventsRequest;
use App\Http\Resources\V1\EventCardResource;
use App\Services\Events\EventFeed;
use App\Services\Events\EventPresenter;
use App\Services\Garage\PublicMembers;
use App\Support\Viewer;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class MemberEventsController extends Controller
{
    /**
     * List a member's events.
     *
     * PROF-01/02 "Treffen": the events the member organises that the reader may see in a list: published, public (followers-only ones
     * for followers), not removed; `when=past` lists those that are over, newest first. Never drafts or events in review, never the exact
     * place of an after_rsvp event. A member the reader may not see: 404 member_unavailable. Guests too.
     *
     * @unauthenticated
     */
    public function __invoke(MemberEventsRequest $request, string $username, PublicMembers $members, EventFeed $feed, EventPresenter $presenter): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);
        $member = $members->visibleTo($viewer, $username) ?? throw new ApiException(ErrorCode::MemberUnavailable);
        $query = $feed->organisedBy($viewer, $member, $request->past());
        $query = $request->past()
            ? $query->orderByDesc('events.starts_at')->orderByDesc('events.id')
            : $query->orderBy('events.starts_at')->orderBy('events.id');

        $page = $query->cursorPaginate($request->pageSize())->withQueryString();
        $presenter->prepare($page->items(), $viewer);

        return EventCardResource::collection($page);
    }
}
