<?php

namespace App\Services\Crews;

use App\Enums\CrewRole;
use App\Enums\CrewStatus;
use App\Enums\ErrorCode;
use App\Enums\UserStatus;
use App\Exceptions\ApiException;
use App\Models\Crew;
use App\Models\CrewInvite;
use App\Models\CrewMember;
use App\Models\CrewRequest;
use App\Models\Media;
use App\Models\User;
use App\Services\Notifications\Notifier;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The membership rows of crews (contract-crews.md §4): the limits (5 memberships, 2 founded), adding a member (their open request and
 * invitation of that crew end, with their notification rows), and the stored member count. Call inside the Action's transaction, after
 * locking the member's row (lockMember) so two joins of one member cannot both pass the limit.
 */
final class CrewMemberships
{
    public function __construct(private readonly Notifier $notifier) {}

    public function lockMember(User $user): void
    {
        User::query()->whereKey($user->id)->lockForUpdate()->value('id');
    }

    /**
     * @throws ApiException 409 limit_reached
     */
    public function assertMayJoin(User $user): void
    {
        $max = config()->integer('speedclub.crews.memberships_max');

        // SF-3: a crew staff deleted (kept for an appeal) holds no slot: its members cannot see or leave it.
        if (self::countable(CrewMember::query()->where('user_id', $user->id))->count() >= $max) {
            throw new ApiException(ErrorCode::LimitReached, (string) __('crews.memberships_limit', ['max' => $max]));
        }
    }

    /**
     * @throws ApiException 409 limit_reached
     */
    public function assertMayFound(User $user): void
    {
        $max = config()->integer('speedclub.crews.founded_max');

        if (self::countable(CrewMember::query()->where('user_id', $user->id)->where('role', CrewRole::Founder->value))->count() >= $max) {
            throw new ApiException(ErrorCode::LimitReached, (string) __('crews.founded_limit', ['max' => $max]));
        }
    }

    /**
     * Open requests of the member that count toward open_requests_max: those to active crews (the ones they can still see and withdraw).
     */
    public function openRequests(User $user): int
    {
        return CrewRequest::query()->where('user_id', $user->id)
            ->whereIn('crew_id', Crew::query()->where('status', CrewStatus::Active->value)->select('id'))
            ->count();
    }

    /**
     * The crew row under a lock, deleted ones included, for the checks an Action makes on what is current (SF-2). Lock the member first
     * (lockMember), then the crew: every crew write takes them in this order (SF-5).
     */
    public function lockCrew(Crew $crew): Crew
    {
        $locked = Crew::withTrashed()->whereKey($crew->id)->lockForUpdate()->first();

        if (! $locked instanceof Crew) {
            throw new ApiException(ErrorCode::CrewUnavailable);
        }

        // The caller's model follows what is locked, so the resource answers the current state.
        $crew->setRawAttributes($locked->getAttributes(), true);

        return $locked;
    }

    /**
     * SF-4: logo and cover a member uploaded pass to the crew's current founder (when it is somebody else), so withdrawing the member's
     * media at account closure, or losing them as admin, never blanks the crew. $crewId null: every crew.
     */
    public function reownMedia(User $from, ?string $crewId = null): void
    {
        $media = Media::withTrashed()->where('owner_id', $from->id)->where('mediable_type', (new Crew)->getMorphClass())
            ->when($crewId !== null, fn ($query) => $query->where('mediable_id', $crewId))
            ->get(['id', 'mediable_id']);

        foreach ($media->groupBy('mediable_id') as $crew => $rows) {
            // The leaving member's own founder row may still be there (account closure hands over first and deletes after).
            $founder = CrewMember::query()->where('crew_id', (string) $crew)->where('role', CrewRole::Founder->value)->where('user_id', '!=', $from->id)->value('user_id');

            if (is_string($founder) && $founder !== $from->id) {
                Media::withTrashed()->whereIn('id', $rows->pluck('id')->all())->update(['owner_id' => $founder]);
            }
        }
    }

    /**
     * @param  Builder<CrewMember>  $query
     * @return Builder<CrewMember>
     */
    private static function countable(Builder $query): Builder
    {
        return $query->whereIn('crew_id', Crew::query()->select('id'));
    }

    public function add(Crew $crew, User $user, CrewRole $role): CrewMember
    {
        $member = new CrewMember;
        $member->forceFill([
            'crew_id' => $crew->id,
            'user_id' => $user->id,
            'role' => $role,
            'role_rank' => $role->rank(),
            'joined_at' => now(),
        ])->save();

        $this->endOpenRows($crew, $user);
        $this->recount($crew);

        return $member;
    }

    /**
     * The member's open request and invitation of this crew end; their notification rows go after the commit.
     */
    public function endOpenRows(Crew $crew, User $user): void
    {
        $request = CrewRequest::query()->where('crew_id', $crew->id)->where('user_id', $user->id)->value('id');
        $invite = CrewInvite::query()->where('crew_id', $crew->id)->where('user_id', $user->id)->value('id');

        if (is_string($request)) {
            CrewRequest::query()->whereKey($request)->delete();
            DB::afterCommit(fn () => $this->notifier->forgetCrew($request, 'request_received'));
        }

        if (is_string($invite)) {
            CrewInvite::query()->whereKey($invite)->delete();
            DB::afterCommit(fn () => $this->notifier->forgetCrew($invite, 'invited'));
        }
    }

    public function setRole(CrewMember $member, CrewRole $role): void
    {
        $member->forceFill(['role' => $role, 'role_rank' => $role->rank()])->save();
    }

    public function recount(Crew $crew): void
    {
        $count = CrewMember::query()->where('crew_id', $crew->id)->count();
        Crew::withTrashed()->whereKey($crew->id)->toBase()->update(['members_count' => $count]);
        $crew->setAttribute('members_count', $count);
        $crew->syncOriginalAttribute('members_count');
    }

    /**
     * The member who takes over a crew whose founder goes: the oldest admin, else the oldest member, else nobody.
     */
    public function successor(Crew $crew, ?User $leaving): ?CrewMember
    {
        $candidates = fn () => CrewMember::query()->with('user')->where('crew_id', $crew->id)->when($leaving !== null, fn ($rows) => $rows->where('user_id', '!=', $leaving?->id))
            ->whereIn('role', [CrewRole::Admin->value, CrewRole::Member->value])
            ->orderBy('role_rank')->orderBy('joined_at')->orderBy('id');

        // An active account first; a suspended one before deleting the crew; never one that is closing itself.
        return $candidates()->whereHas('user', fn ($user) => $user->where('status', UserStatus::Active->value))->first()
            ?? $candidates()->whereHas('user', fn ($user) => $user->where('status', '!=', UserStatus::Deactivated->value))->first();
    }
}
