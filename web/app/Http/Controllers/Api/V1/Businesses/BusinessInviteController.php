<?php

namespace App\Http\Controllers\Api\V1\Businesses;

use App\Actions\Businesses\ChangeBusinessTeam;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Businesses\BusinessPageRequest;
use App\Http\Resources\V1\BusinessInviteResource;
use App\Http\Resources\V1\MyBusinessResource;
use App\Models\Business;
use App\Models\BusinessInvite;
use App\Models\User;
use App\Services\Businesses\BusinessListing;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * SEC-414-01 (09 §8.10 "invited staff"): the invited member's side of a team invitation. The member lists their open invitations,
 * accepts one (they join that team as staff) or declines it. Another member's invitation answers like a missing one (404).
 */
class BusinessInviteController extends Controller
{
    /**
     * List my team invitations.
     *
     * Open invitations of businesses to their team, newest first (at most one per business); cursor pages. Never one of a business
     * taken down, or whose owner the member blocked or was blocked by. Each `business` is a BusinessCard with its `cover` (ADR-457: its
     * own, else its newest portfolio build's).
     */
    public function index(BusinessPageRequest $request, BusinessListing $listing): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();

        $page = BusinessInvite::query()->with(['business.owner', 'business.logo', 'business.cover', 'inviter'])
            ->where('user_id', $user->id)
            ->whereHas('business', fn (Builder $business) => $business->whereNull('removed_at')
                ->whereNotExists(fn (QueryBuilder $mine) => $mine->selectRaw('1')->from('blocks', 'b')->where('b.blocker_id', $user->id)->whereColumn('b.blocked_id', 'businesses.owner_id'))
                ->whereNotExists(fn (QueryBuilder $theirs) => $theirs->selectRaw('1')->from('blocks', 'bt')->whereColumn('bt.blocker_id', 'businesses.owner_id')->where('bt.blocked_id', $user->id)))
            ->orderByDesc('created_at')->orderByDesc('id')
            ->cursorPaginate($request->pageSize())->withQueryString();
        // ADR-457: the card's cover fallback, prepared for the whole page in one query (as the Betriebe list does).
        $listing->prepareCovers(array_map(fn (BusinessInvite $invite): Business => $invite->business, $page->items()), $user);

        return BusinessInviteResource::collection($page);
    }

    /**
     * Accept a team invitation.
     *
     * Accepts an Idempotency-Key header. The member joins the business as staff and gets its dashboard (BIZ-03). 409 business_exists when
     * the member owns or works for a business already; 404 business_unavailable when the business is gone or a block came between;
     * 409 limit_reached when the team is full. The member's other invitations end.
     */
    public function accept(Request $request, string $invite, ChangeBusinessTeam $team, BusinessListing $listing): MyBusinessResource
    {
        /** @var User $user */
        $user = $request->user();
        $row = $this->invite($user, $invite);
        Gate::forUser($user)->authorize('respond', $row);

        $business = Business::query()->with(['owner', 'logo', 'cover'])->findOrFail($team->accept($user, $row)->id);
        $business->portfolioCount = $listing->portfolioCount($user, $business);

        return new MyBusinessResource($business);
    }

    /**
     * Decline a team invitation.
     *
     * The invitation ends; the business owner hears about it. Answers 204.
     */
    public function decline(Request $request, string $invite, ChangeBusinessTeam $team): Response
    {
        /** @var User $user */
        $user = $request->user();
        $row = $this->invite($user, $invite);
        Gate::forUser($user)->authorize('decline', $row);
        $team->decline($user, $row);

        return response()->noContent();
    }

    private function invite(User $user, string $id): BusinessInvite
    {
        $invite = BusinessInvite::query()->where('user_id', $user->id)->find(strtolower($id));

        if (! $invite instanceof BusinessInvite) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return $invite;
    }
}
