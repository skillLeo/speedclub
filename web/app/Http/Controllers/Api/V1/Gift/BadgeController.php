<?php

namespace App\Http\Controllers\Api\V1\Gift;

use App\Actions\Gift\MarkBadgesSeen;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Gift\BadgeListRequest;
use App\Http\Requests\Api\V1\Gift\MarkBadgesSeenRequest;
use App\Http\Resources\V1\BadgeResource;
use App\Models\User;
use App\Services\Badges\BadgeCatalog;
use App\Services\Garage\PublicMembers;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

class BadgeController extends Controller
{
    /**
     * My badges.
     *
     * M5.9d (m5.9d contract §2, §10.2): every active badge with `earned_at` (null while not earned), in the admin's order. A hidden badge
     * not earned yet reads `hidden: true` with its hint only ("???"). `?unseen=1`: only the badges earned since the unlock toast last
     * showed, newest first; POST me/badges/seen ends them. Fixed rules only, never random.
     */
    public function mine(BadgeListRequest $request, BadgeCatalog $catalog): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();

        return BadgeResource::collection($catalog->forMember($user, $request->unseen()));
    }

    /**
     * The unlock toast showed these badges.
     *
     * Body `{keys: string[]}` (1–100). Keys the member has not earned or saw before change nothing. 204.
     */
    public function seen(MarkBadgesSeenRequest $request, MarkBadgesSeen $action): Response
    {
        /** @var User $user */
        $user = $request->user();
        $action->handle($user, $request->keys());

        return response()->noContent();
    }

    /**
     * A member's badges.
     *
     * M5.9d: the member's earned, active badges, newest first (a hidden badge only once earned). 404 `member_unavailable` where the
     * profile is (unknown, unverified, suspended, a block either way). Guests too.
     *
     * @unauthenticated
     */
    public function member(Request $request, string $username, PublicMembers $members, BadgeCatalog $catalog): AnonymousResourceCollection
    {
        $member = $members->visibleTo(Viewer::from($request), $username) ?? throw new ApiException(ErrorCode::MemberUnavailable);

        return BadgeResource::collection($catalog->earnedBy($member));
    }
}
