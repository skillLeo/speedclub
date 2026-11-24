<?php

namespace App\Actions\Crews;

use App\Enums\CrewRole;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Crew;
use App\Models\CrewInvite;
use App\Models\CrewMember;
use App\Models\User;
use App\Services\Crews\CrewMemberships;
use App\Services\Garage\PublicMembers;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Invitations into a crew (contract-crews.md §3 #20–23). Founder and admins invite a member by username in every join mode; somebody
 * unknown, not publicly visible or with a block either way with the inviter answers like an unknown name (422 on `username`). The member
 * accepts (joins as member; 409 limit_reached in memberships_max crews) or declines (silent); admins withdraw an open invitation. The
 * invitation's notification row goes with it.
 */
class CrewInvitations
{
    public function __construct(
        private readonly PublicMembers $members,
        private readonly CrewMemberships $memberships,
        private readonly Notifier $notifier,
    ) {}

    public function invite(User $by, Crew $crew, string $username): CrewInvite
    {
        $member = $this->members->find(ltrim($username, '@'));

        if (! $member instanceof User || ! $member->isPubliclyVisible() || $member->is($by) || $member->hasBlockWith($by)) {
            throw ValidationException::withMessages(['username' => [(string) __('crews.member_unknown')]]);
        }

        $invite = DB::transaction(function () use ($by, $crew, $member): CrewInvite {
            CrewFields::assertActive($this->memberships->lockCrew($crew));

            if (CrewMember::query()->where('crew_id', $crew->id)->where('user_id', $member->id)->exists()) {
                throw ValidationException::withMessages(['username' => [(string) __('crews.member_already')]]);
            }

            if (CrewInvite::query()->where('crew_id', $crew->id)->where('user_id', $member->id)->exists()) {
                throw ValidationException::withMessages(['username' => [(string) __('crews.member_invited')]]);
            }

            $max = config()->integer('speedclub.crews.open_invites_max');

            if (CrewInvite::query()->where('crew_id', $crew->id)->count() >= $max) {
                throw new ApiException(ErrorCode::LimitReached, (string) __('crews.invites_limit', ['max' => $max]));
            }

            $invite = new CrewInvite;
            $invite->forceFill(['crew_id' => $crew->id, 'user_id' => $member->id, 'invited_by' => $by->id])->save();

            return $invite;
        });

        $this->notifier->crew($member, $crew, $by, $invite->id, 'invited');

        return $invite->setRelation('user', $member)->setRelation('inviter', $by)->setRelation('crew', $crew);
    }

    public function withdraw(Crew $crew, CrewInvite $invite): void
    {
        if ($invite->crew_id !== $crew->id) {
            throw new ApiException(ErrorCode::NotFound);
        }

        if (CrewInvite::query()->whereKey($invite->id)->delete() > 0) {
            $this->notifier->forgetCrew($invite->id, 'invited');
        }
    }

    /**
     * 404 crew_unavailable when the crew is gone or not active, or a block came between the member and the inviter.
     */
    public function accept(User $member, CrewInvite $invite): Crew
    {
        $crew = DB::transaction(function () use ($member, $invite): Crew {
            $this->memberships->lockMember($member);
            $locked = CrewInvite::query()->with('inviter')->whereKey($invite->id)->lockForUpdate()->first();
            $crew = $locked instanceof CrewInvite ? Crew::query()->whereKey($locked->crew_id)->lockForUpdate()->first() : null;

            if (! $locked instanceof CrewInvite || ! $crew instanceof Crew || ! $crew->isActive()
                || ($locked->inviter instanceof User && $member->hasBlockWith($locked->inviter))) {
                throw new ApiException(ErrorCode::CrewUnavailable);
            }

            if (! CrewMember::query()->where('crew_id', $crew->id)->where('user_id', $member->id)->exists()) {
                $this->memberships->assertMayJoin($member);
                $this->memberships->add($crew, $member, CrewRole::Member);
            } else {
                $this->memberships->endOpenRows($crew, $member);
            }

            return $crew;
        });

        $this->notifier->forgetCrew($invite->id, 'invited');

        return $crew;
    }

    public function decline(CrewInvite $invite): void
    {
        if (CrewInvite::query()->whereKey($invite->id)->delete() > 0) {
            $this->notifier->forgetCrew($invite->id, 'invited');
        }
    }
}
