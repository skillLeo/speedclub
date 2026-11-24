<?php

namespace App\Actions\Crews;

use App\Enums\CrewJoinMode;
use App\Enums\CrewRole;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Crew;
use App\Models\CrewInvite;
use App\Models\CrewMember;
use App\Models\CrewRequest;
use App\Models\User;
use App\Services\Crews\CrewMemberships;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;

/**
 * The member's own side of a crew (contract-crews.md §3 #13–15). join(): an open crew, or any crew with an open invitation, takes the
 * member at once; a `request` crew gets a request its founder and admins hear about; an `invite` crew without an invitation is 403.
 * Asking twice changes nothing. withdraw(): the member's open request goes. leave(): members and admins leave; the founder hands over or
 * deletes first (409).
 */
class JoinCrew
{
    public function __construct(private readonly CrewMemberships $memberships, private readonly Notifier $notifier) {}

    /**
     * @return 'member'|'requested'
     */
    public function join(User $member, Crew $crew): string
    {
        [$state, $request] = DB::transaction(function () use ($member, $crew): array {
            $this->memberships->lockMember($member);
            // SF-2: the state that counts is the locked row's (the founder may have deleted it, staff hidden it, in the meantime).
            CrewFields::assertActive($this->memberships->lockCrew($crew));

            if (CrewMember::query()->where('crew_id', $crew->id)->where('user_id', $member->id)->exists()) {
                return ['member', null];
            }

            // SF-6: an invitation counts only while no block stands between the member and whoever sent it (as accept() rules).
            $invite = CrewInvite::query()->with('inviter')->where('crew_id', $crew->id)->where('user_id', $member->id)->first();
            $invited = $invite instanceof CrewInvite && ! ($invite->inviter instanceof User && $member->hasBlockWith($invite->inviter));

            if ($invited || $crew->join_mode === CrewJoinMode::Open) {
                $this->memberships->assertMayJoin($member);
                $this->memberships->add($crew, $member, CrewRole::Member);

                return ['member', null];
            }

            if ($crew->join_mode === CrewJoinMode::Invite) {
                throw new ApiException(ErrorCode::Forbidden, (string) __('crews.invite_only'));
            }

            if (CrewRequest::query()->where('crew_id', $crew->id)->where('user_id', $member->id)->exists()) {
                return ['requested', null];
            }

            // A member already in five crews cannot be approved anyway: tell them now.
            $this->memberships->assertMayJoin($member);
            $max = config()->integer('speedclub.crews.open_requests_max');

            if ($this->memberships->openRequests($member) >= $max) {
                throw new ApiException(ErrorCode::LimitReached, (string) __('crews.requests_limit', ['max' => $max]));
            }

            $request = new CrewRequest;
            $request->forceFill(['crew_id' => $crew->id, 'user_id' => $member->id])->save();

            return ['requested', $request];
        });

        if ($request instanceof CrewRequest) {
            $admins = CrewMember::query()->with('user')->where('crew_id', $crew->id)
                ->whereIn('role', [CrewRole::Founder->value, CrewRole::Admin->value])->get();

            foreach ($admins as $admin) {
                $this->notifier->crew($admin->user, $crew, $member, $request->id, 'request_received');
            }
        }

        return $state;
    }

    public function withdraw(User $member, Crew $crew): void
    {
        $id = DB::transaction(function () use ($member, $crew): ?string {
            $id = CrewRequest::query()->where('crew_id', $crew->id)->where('user_id', $member->id)->lockForUpdate()->value('id');

            if (is_string($id)) {
                CrewRequest::query()->whereKey($id)->delete();
            }

            return is_string($id) ? $id : null;
        });

        if ($id !== null) {
            $this->notifier->forgetCrew($id, 'request_received');
        }
    }

    public function leave(User $member, Crew $crew): void
    {
        DB::transaction(function () use ($member, $crew): void {
            $this->memberships->lockMember($member);
            $this->memberships->lockCrew($crew);
            $row = CrewMember::query()->where('crew_id', $crew->id)->where('user_id', $member->id)->first();

            if (! $row instanceof CrewMember) {
                throw new ApiException(ErrorCode::CrewUnavailable);
            }

            if ($row->role === CrewRole::Founder) {
                throw new ApiException(ErrorCode::Conflict, (string) __('crews.founder_cannot_leave'));
            }

            $row->delete();
            $this->memberships->recount($crew);
            $this->memberships->reownMedia($member, $crew->id);
        });
    }
}
