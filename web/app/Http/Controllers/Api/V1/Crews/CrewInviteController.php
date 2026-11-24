<?php

namespace App\Http\Controllers\Api\V1\Crews;

use App\Actions\Crews\CrewInvitations;
use App\Enums\CrewStatus;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Crews\CrewPageRequest;
use App\Http\Requests\Api\V1\Crews\CrewUsernameRequest;
use App\Http\Resources\V1\Crews\CrewInviteResource;
use App\Http\Resources\V1\Crews\CrewResource;
use App\Models\Crew;
use App\Models\CrewInvite;
use App\Models\User;
use App\Services\Discover\VisibleBuilds;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * Invitations into crews (contract-crews.md §3 #6, #19–23): the crew's side (founder and admins invite, list, withdraw) and the invited
 * member's side (list, accept, decline). Another member's invitation answers like a missing one (404).
 */
class CrewInviteController extends Controller
{
    use FindsCrews;

    /**
     * List a crew's open invitations.
     *
     * Founder and admins; newest first.
     */
    public function index(CrewPageRequest $request, string $slug, VisibleBuilds $builds): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();
        $crew = $this->crew($slug, $user);
        Gate::authorize('update', $crew);

        // MF-1 (C3): invitations of members the reader has a block with are left out, as on the requests list.
        $query = CrewInvite::query()->with(['crew.logo', 'crew.cover', 'user.avatar', 'inviter.avatar'])->where('crew_invites.crew_id', $crew->id);
        $builds->withoutBlocks($query->getQuery(), $user, 'crew_invites.user_id');

        return CrewInviteResource::collection($query->orderByDesc('created_at')->orderByDesc('id')->cursorPaginate($request->pageSize())->withQueryString());
    }

    /**
     * Invite a member.
     *
     * Accepts an Idempotency-Key header. Founder and admins, in every join mode. The member hears about it in the app and accepts with
     * POST me/crew-invites/{invite}/accept. Unknown, not visible, blocked either way, already a member or invited: 422 on `username`;
     * at most 50 open invitations (409 limit_reached).
     */
    public function store(CrewUsernameRequest $request, string $slug, CrewInvitations $invitations): CrewInviteResource
    {
        /** @var User $user */
        $user = $request->user();
        $crew = $this->crew($slug, $user);
        Gate::authorize('update', $crew);
        $crew->load(['logo', 'cover']);

        /** @status 201 */
        return new CrewInviteResource($invitations->invite($user, $crew, $request->username()));
    }

    /**
     * Withdraw an invitation.
     *
     * Founder and admins. Answers 204.
     */
    public function destroy(Request $request, string $slug, string $id, CrewInvitations $invitations): Response
    {
        /** @var User $user */
        $user = $request->user();
        $crew = $this->crew($slug, $user);
        Gate::authorize('update', $crew);
        $invite = CrewInvite::query()->where('crew_id', $crew->id)->find(strtolower($id)) ?? throw new ApiException(ErrorCode::NotFound);
        $invitations->withdraw($crew, $invite);

        return response()->noContent();
    }

    /**
     * List my crew invitations.
     *
     * Open invitations to the member, newest first; never one of a crew that is not active or whose inviter has a block with the member.
     */
    public function mine(CrewPageRequest $request): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();

        $page = CrewInvite::query()->with(['crew.logo', 'crew.cover', 'user.avatar', 'inviter.avatar'])
            ->where('crew_invites.user_id', $user->id)
            ->whereHas('crew', fn (Builder $crew) => $crew->where('status', CrewStatus::Active->value))
            ->whereNotExists(fn (QueryBuilder $mine) => $mine->selectRaw('1')->from('blocks', 'b')->where('b.blocker_id', $user->id)->whereColumn('b.blocked_id', 'crew_invites.invited_by'))
            ->whereNotExists(fn (QueryBuilder $theirs) => $theirs->selectRaw('1')->from('blocks', 'bt')->whereColumn('bt.blocker_id', 'crew_invites.invited_by')->where('bt.blocked_id', $user->id))
            ->orderByDesc('created_at')->orderByDesc('id')
            ->cursorPaginate($request->pageSize())->withQueryString();

        return CrewInviteResource::collection($page);
    }

    /**
     * Accept a crew invitation.
     *
     * Accepts an Idempotency-Key header. The member joins as a member. 404 crew_unavailable when the crew is gone or hidden, or a block
     * came between; 409 limit_reached in 5 crews.
     */
    public function accept(Request $request, string $id, CrewInvitations $invitations): CrewResource
    {
        /** @var User $user */
        $user = $request->user();
        $invite = $this->invite($user, $id);

        // SF-7: a crew staff deleted keeps its invitations for a restore; for the member it is gone.
        $crew = Crew::query()->find($invite->crew_id) ?? throw new ApiException(ErrorCode::CrewUnavailable);
        Gate::authorize('join', $crew);

        return $this->present($invitations->accept($user, $invite), $user);
    }

    /**
     * Decline a crew invitation.
     *
     * The invitation goes; nobody is told. Answers 204.
     */
    public function decline(Request $request, string $id, CrewInvitations $invitations): Response
    {
        /** @var User $user */
        $user = $request->user();
        $invitations->decline($this->invite($user, $id));

        return response()->noContent();
    }

    private function invite(User $user, string $id): CrewInvite
    {
        $invite = CrewInvite::query()->with('crew')->where('user_id', $user->id)->find(strtolower($id));

        return $invite instanceof CrewInvite ? $invite : throw new ApiException(ErrorCode::NotFound);
    }
}
