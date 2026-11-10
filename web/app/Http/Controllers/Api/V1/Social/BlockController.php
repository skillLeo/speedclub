<?php

namespace App\Http\Controllers\Api\V1\Social;

use App\Actions\Social\BlockMember;
use App\Actions\Social\UnblockMember;
use App\Enums\ErrorCode;
use App\Enums\UserStatus;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Social\BlockMemberRequest;
use App\Http\Requests\Api\V1\Social\OwnListRequest;
use App\Http\Resources\V1\BlockedMemberResource;
use App\Http\Resources\V1\BlockStateResource;
use App\Models\Block;
use App\Models\User;
use App\Services\Garage\PublicMembers;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * Block (02_PRODUCT_SPEC §3.5, SET-08). A safety tool, so open to unverified and restricted members (BlockPolicy). Answers carry the
 * name as sent and the viewer's own side only: nothing here tells whether the other member blocked the viewer, nor their new name.
 */
class BlockController extends Controller
{
    public function __construct(private readonly PublicMembers $members) {}

    /**
     * Block a member.
     *
     * 100 blocks and unblocks a day. Blocking twice changes nothing. Ends follows in both directions. 404 `member_unavailable` only when
     * no account has the name; yourself: 422 `validation_failed`.
     */
    public function store(BlockMemberRequest $request, string $username, BlockMember $action): BlockStateResource
    {
        /** @var User $user */
        $user = $request->user();
        $member = $this->members->find($username) ?? throw new ApiException(ErrorCode::MemberUnavailable);

        Gate::authorize('create', [Block::class, $member]);

        $action->handle($user, $member, $this->asSent($username));

        return BlockStateResource::of($this->asSent($username), true);
    }

    /**
     * Unblock a member.
     *
     * Any name answers 200 with `is_blocked` false, so this route tells nothing about who exists. Follows the block ended stay ended.
     */
    public function destroy(Request $request, string $username, UnblockMember $action): BlockStateResource
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('unblock', Block::class);

        $action->handle($user, $this->members->find($username), $this->asSent($username));

        return BlockStateResource::of($this->asSent($username), false);
    }

    /**
     * List the members I blocked.
     *
     * Newest block first, each with the name the member blocked, as sent: never the blocked member's current name, display name or
     * picture. A member who has since deleted the account is not listed.
     */
    public function index(OwnListRequest $request): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('viewAny', Block::class);

        return BlockedMemberResource::collection(
            $user->blockedUsers()
                ->withPivot('id')
                ->where('users.status', '!=', UserStatus::Deactivated)
                ->orderByDesc('blocks.created_at')
                ->orderByDesc('blocks.id')
                ->cursorPaginate($request->pageSize(), ['users.*'])
                ->withQueryString()
        );
    }

    private function asSent(string $username): string
    {
        return mb_strtolower(trim($username));
    }
}
