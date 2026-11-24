<?php

namespace App\Http\Controllers\Api\V1\Public;

use App\Enums\ErrorCode;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Garage\GarageListRequest;
use App\Http\Resources\V1\BuildUpdateRowResource;
use App\Http\Resources\V1\MemberProfileResource;
use App\Http\Resources\V1\VehicleCardResource;
use App\Models\User;
use App\Services\Dex\GhostMode;
use App\Services\Garage\PublicMembers;
use App\Services\Social\MemberUpdates;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * PROF-02. Unverified, suspended, deactivated or across a block: 404 `member_unavailable`, like a name nobody has.
 */
class PublicMemberController extends Controller
{
    public function __construct(private readonly PublicMembers $members) {}

    /**
     * Read a member's public profile.
     *
     * An old username works for 14 days after a change. `username` in the answer is the current one: when it differs from what
     * was asked for, the client redirects.
     *
     * @unauthenticated
     */
    public function show(Request $request, string $username): MemberProfileResource
    {
        return new MemberProfileResource($this->visible($request, $username));
    }

    /**
     * List a member's public vehicles.
     *
     * Public ones only: an unlisted vehicle is reachable by link and QR alone, and so is a ghost car (M5.9b), except for its owner. Main
     * vehicle first.
     *
     * @unauthenticated
     */
    public function vehicles(GarageListRequest $request, string $username): AnonymousResourceCollection
    {
        $member = $this->visible($request, $username);

        return VehicleCardResource::collection(
            $member->vehicles()
                ->where('status', VehicleStatus::Published)
                ->where('visibility', Visibility::Public)
                // M5.9b: a ghost car is in no garage list of others; its owner still sees it.
                ->when(! $member->is(Viewer::from($request)), fn ($query) => GhostMode::constrain($query))
                ->with(VehicleCardResource::RELATIONS)
                ->withCount('modifications')
                ->orderByDesc('is_main')
                ->orderBy('sort')
                ->orderBy('id')
                ->cursorPaginate($request->pageSize())
                ->withQueryString()
        );
    }

    /**
     * List a member's build updates.
     *
     * PROF-01/02 "Updates": newest first across the member's public builds, each with its build card and `type`. Hidden updates, unlisted
     * and private builds are left out; followers-only updates only for the owner and followers. Guests too.
     *
     * @unauthenticated
     */
    public function updates(GarageListRequest $request, string $username, MemberUpdates $updates): AnonymousResourceCollection
    {
        $member = $this->visible($request, $username);

        return BuildUpdateRowResource::collection($updates->page(Viewer::from($request), $member, $request->pageSize()));
    }

    private function visible(Request $request, string $username): User
    {
        return $this->members->visibleTo(Viewer::from($request), $username) ?? throw new ApiException(ErrorCode::MemberUnavailable);
    }
}
