<?php

namespace App\Http\Controllers\Api\V1\Crews;

use App\Actions\Crews\JoinCrew;
use App\Enums\CrewStatus;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Crews\CrewPageRequest;
use App\Http\Resources\V1\Crews\CrewRequestResource;
use App\Http\Resources\V1\Crews\CrewResource;
use App\Http\Resources\V1\Crews\MemberCrewResource;
use App\Models\Crew;
use App\Models\CrewRequest;
use App\Models\User;
use App\Services\Crews\CrewListing;
use App\Services\Garage\PublicMembers;
use App\Support\Viewer;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * The member's own side of crews (contract-crews.md §3 #4–7, #13–15): joining, asking, leaving, "Meine Crews", their open requests, and
 * the crews of a member's profile.
 */
class CrewMembershipController extends Controller
{
    use FindsCrews;

    /**
     * Join a crew.
     *
     * Accepts an Idempotency-Key header. An open crew, or any crew with an open invitation for the member: they join (`viewer.state`
     * member). A request crew: a join request its founder and admins hear about (`viewer.state` requested). An invite-only crew: 403.
     * Asking twice changes nothing. 409 limit_reached in 5 crews or with 10 open requests; 409 conflict while staff hide the crew.
     */
    public function join(Request $request, string $slug, JoinCrew $action): CrewResource
    {
        /** @var User $user */
        $user = $request->user();
        $crew = $this->crew($slug, $user);
        Gate::authorize('join', $crew);
        $action->join($user, $crew);

        return $this->present($crew->refresh(), $user);
    }

    /**
     * Withdraw my join request.
     *
     * Answers 204, also when there was none.
     */
    public function withdraw(Request $request, string $slug, JoinCrew $action): Response
    {
        /** @var User $user */
        $user = $request->user();
        // SF-3: the member's own request can be withdrawn also while staff hide the crew (they cannot see it then).
        $slug = mb_strtolower($slug);
        $crew = Crew::query()->where('slug', $slug)->first() ?? Crew::query()->where('previous_slug', $slug)->first();

        if ($crew instanceof Crew) {
            $action->withdraw($user, $crew);
        }

        return response()->noContent();
    }

    /**
     * Leave a crew.
     *
     * Members and admins; the founder hands over or deletes the crew first (409 conflict). Answers 204.
     */
    public function leave(Request $request, string $slug, JoinCrew $action): Response
    {
        /** @var User $user */
        $user = $request->user();
        $action->leave($user, $this->crew($slug, $user));

        return response()->noContent();
    }

    /**
     * List my crews.
     *
     * "Meine Crews": every crew the member is in (a crew staff hid shows `status` hidden), A–Z, with open request and invitation counts
     * for the crews they run.
     */
    public function mine(Request $request, CrewListing $listing): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();

        return CrewResource::collection($listing->mine($user));
    }

    /**
     * List my join requests.
     *
     * Open requests of the member, newest first.
     */
    public function requests(CrewPageRequest $request): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();

        return CrewRequestResource::collection(CrewRequest::query()->with(['crew.logo', 'crew.cover', 'user.avatar'])
            ->where('user_id', $user->id)
            ->whereHas('crew', fn (Builder $crew) => $crew->where('status', CrewStatus::Active->value))
            ->orderByDesc('created_at')->orderByDesc('id')
            ->cursorPaginate($request->pageSize())->withQueryString());
    }

    /**
     * List a member's crews.
     *
     * PROF-01/02 crew chips: the active crews the member is in, A–Z, each with the member's `role`. A member the reader may not see:
     * 404 member_unavailable. Guests too.
     *
     * @unauthenticated
     */
    public function ofMember(Request $request, string $username, PublicMembers $members, CrewListing $listing): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);
        $member = $members->visibleTo($viewer, $username) ?? throw new ApiException(ErrorCode::MemberUnavailable);

        return MemberCrewResource::collection($listing->ofMember($member, $viewer));
    }
}
