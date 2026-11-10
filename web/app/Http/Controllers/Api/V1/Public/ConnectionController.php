<?php

namespace App\Http\Controllers\Api\V1\Public;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Social\ConnectionListRequest;
use App\Http\Resources\V1\ConnectionResource;
use App\Models\User;
use App\Services\Garage\PublicMembers;
use App\Services\Social\Connections;
use App\Support\Viewer;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * PROF-04. Guests may read, like the profile itself. 404 `member_unavailable` when the profile is not visible to the viewer, the same
 * as the profile route. Rows are members the viewer may see; the profile's `stats` stay the numbers of the tabs, so a list across a
 * block can be shorter than its count, and nothing says which row is missing.
 */
class ConnectionController extends Controller
{
    public function __construct(
        private readonly PublicMembers $members,
        private readonly Connections $connections,
    ) {}

    /**
     * List a member's followers.
     *
     * Newest follow first. `q` narrows by username or display name, word by word from the start, as member search does.
     *
     * @unauthenticated
     */
    public function followers(ConnectionListRequest $request, string $username): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);
        $member = $this->visible($viewer, $username);

        return ConnectionResource::collection($this->connections->followers($member, $viewer, $request->nameWords(), $request->pageSize()));
    }

    /**
     * List whom a member follows.
     *
     * Newest follow first. `q` narrows by username or display name, word by word from the start, as member search does.
     *
     * @unauthenticated
     */
    public function following(ConnectionListRequest $request, string $username): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);
        $member = $this->visible($viewer, $username);

        return ConnectionResource::collection($this->connections->following($member, $viewer, $request->nameWords(), $request->pageSize()));
    }

    private function visible(?User $viewer, string $username): User
    {
        // UserPolicy::view through PublicMembers: unverified, suspended, deactivated, across a block or nobody: all the same 404.
        return $this->members->visibleTo($viewer, $username) ?? throw new ApiException(ErrorCode::MemberUnavailable);
    }
}
