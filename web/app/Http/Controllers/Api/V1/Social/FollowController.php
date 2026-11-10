<?php

namespace App\Http\Controllers\Api\V1\Social;

use App\Actions\Social\FollowMember;
use App\Actions\Social\UnfollowMember;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\FollowStateResource;
use App\Models\Follow;
use App\Models\User;
use App\Services\Garage\PublicMembers;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Follow a member (02_PRODUCT_SPEC §3.5). Both directions are idempotent: the answer is the state, not whether it changed.
 * Lists and notifications are Phase 2.
 */
class FollowController extends Controller
{
    public function __construct(private readonly PublicMembers $members) {}

    /**
     * Follow a member.
     *
     * 200 follows a day. Following twice changes nothing. Yourself: 403. Unverified addresses: 403 `email_not_verified`.
     * Someone you cannot see, also across a block: 404 `member_unavailable`.
     */
    public function store(Request $request, string $username, FollowMember $action): FollowStateResource
    {
        /** @var User $user */
        $user = $request->user();
        $member = $this->members->visibleTo($user, $username) ?? throw new ApiException(ErrorCode::MemberUnavailable);

        Gate::authorize('create', [Follow::class, $member]);

        $action->handle($user, $member);

        return new FollowStateResource($member);
    }

    /**
     * Stop following a member.
     *
     * Any name answers 200 and not following is no error, so this route tells nothing about who exists. The row goes whatever
     * the other member's state. Someone you cannot see, also across a block, and a name nobody has answer with the name as you
     * sent it and `followers` null.
     */
    public function destroy(Request $request, string $username, UnfollowMember $action): FollowStateResource
    {
        /** @var User $user */
        $user = $request->user();
        $member = $this->members->find($username);

        if ($member !== null) {
            $action->handle($user, $member);
        }

        return $member !== null && Gate::allows('view', $member)
            ? new FollowStateResource($member)
            : FollowStateResource::neutral($username);
    }
}
