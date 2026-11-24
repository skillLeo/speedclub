<?php

namespace App\Http\Controllers\Api\V1\Crews;

use App\Actions\Crews\DecideCrewRequest;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Crews\CrewPageRequest;
use App\Http\Resources\V1\Crews\CrewMemberResource;
use App\Http\Resources\V1\Crews\CrewRequestResource;
use App\Models\Crew;
use App\Models\CrewRequest;
use App\Models\User;
use App\Services\Crews\CrewListing;
use App\Services\Discover\VisibleBuilds;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * Join requests of a crew for its founder and admins (contract-crews.md §3 #16–18).
 */
class CrewRequestController extends Controller
{
    use FindsCrews;

    /**
     * List a crew's join requests.
     *
     * Founder and admins; oldest first. Requests of members the reader has a block with are left out (they cannot decide them).
     */
    public function index(CrewPageRequest $request, string $slug, VisibleBuilds $builds): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();
        $crew = $this->crew($slug, $user);
        Gate::authorize('update', $crew);

        $query = CrewRequest::query()->with(['crew.logo', 'crew.cover', 'user.avatar'])->where('crew_requests.crew_id', $crew->id);
        $builds->withoutBlocks($query->getQuery(), $user, 'crew_requests.user_id');

        return CrewRequestResource::collection($query->orderBy('created_at')->orderBy('id')->cursorPaginate($request->pageSize())->withQueryString());
    }

    /**
     * Approve a join request.
     *
     * Accepts an Idempotency-Key header. The member joins and hears about it. 409 limit_reached when they are in 5 crews meanwhile (the
     * request stays); 404 for a request of somebody the reader has a block with.
     */
    public function approve(Request $request, string $slug, string $id, DecideCrewRequest $action, CrewListing $listing): CrewMemberResource
    {
        /** @var User $user */
        $user = $request->user();
        [$crew, $row] = $this->request($user, $slug, $id);
        $member = $action->approve($user, $crew, $row);
        $listing->attachVehicles([$member], $user);

        /** @status 201 */
        return new CrewMemberResource($member);
    }

    /**
     * Decline a join request.
     *
     * The request goes; the member is not told. Answers 204.
     */
    public function decline(Request $request, string $slug, string $id, DecideCrewRequest $action): Response
    {
        /** @var User $user */
        $user = $request->user();
        [$crew, $row] = $this->request($user, $slug, $id);
        $action->decline($user, $crew, $row);

        return response()->noContent();
    }

    /**
     * @return array{0: Crew, 1: CrewRequest}
     */
    private function request(User $user, string $slug, string $id): array
    {
        $crew = $this->crew($slug, $user);
        Gate::authorize('update', $crew);
        $row = CrewRequest::query()->with('user')->where('crew_id', $crew->id)->find(strtolower($id));

        return $row instanceof CrewRequest ? [$crew, $row] : throw new ApiException(ErrorCode::NotFound);
    }
}
