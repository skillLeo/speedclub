<?php

namespace App\Actions\Crews;

use App\Enums\CrewAuditEvent;
use App\Enums\CrewRole;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Crew;
use App\Models\CrewMember;
use App\Models\Media;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Crews\CrewMemberships;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Who is who in a crew (contract-crews.md §3 #24–26, §4). remove(): the founder removes anyone but themselves, an admin only plain
 * members (403 otherwise); silent for the member. changeRole(): the founder makes a member admin or an admin member. handOver(): the
 * founder makes a member the founder (409 limit_reached when that member already founds founded_max crews) and stays as admin; logo
 * and cover they uploaded pass along. Each step is audited with the acting member.
 */
class CrewRoles
{
    public function __construct(private readonly CrewMemberships $memberships) {}

    public function remove(User $by, Crew $crew, CrewMember $member): void
    {
        if ($member->crew_id !== $crew->id) {
            throw new ApiException(ErrorCode::Forbidden, (string) __('crews.remove_not_allowed'));
        }

        DB::transaction(function () use ($by, $crew, $member): void {
            // SF-1: who may remove whom is decided on rows read under the crew lock (a hand-over may have made the target founder).
            $this->memberships->lockCrew($crew);
            [$actor, $target] = $this->rows($crew, $by, $member);

            if ($target === null) {
                return;
            }

            $allowed = $target->user_id !== $by->id && match ($actor?->role) {
                CrewRole::Founder => true,
                CrewRole::Admin => $target->role === CrewRole::Member,
                default => false,
            };

            if (! $allowed) {
                throw new ApiException(ErrorCode::Forbidden, (string) __('crews.remove_not_allowed'));
            }

            $target->delete();
            $this->memberships->recount($crew);
            // SF-4: an admin's uploads stay with the crew.
            $this->memberships->reownMedia($member->user, $crew->id);
            Audit::record(CrewAuditEvent::MemberRemoved->value, $crew, ['username' => $member->user->username, 'role' => $target->role->value], null, actor: $by);
        });
    }

    public function changeRole(User $by, Crew $crew, CrewMember $member, CrewRole $role): CrewMember
    {
        if ($member->crew_id !== $crew->id || $role === CrewRole::Founder) {
            throw ValidationException::withMessages(['role' => [(string) __('crews.role_fixed')]]);
        }

        return DB::transaction(function () use ($by, $crew, $member, $role): CrewMember {
            // SF-1: under the crew lock, on fresh rows: the actor is still the founder, the target is not (yet) the founder.
            CrewFields::assertActive($this->memberships->lockCrew($crew));
            [$actor, $target] = $this->rows($crew, $by, $member);

            if ($actor?->role !== CrewRole::Founder) {
                throw new ApiException(ErrorCode::Forbidden);
            }

            if ($target === null) {
                throw new ApiException(ErrorCode::NotFound);
            }

            if ($target->role === CrewRole::Founder) {
                throw ValidationException::withMessages(['role' => [(string) __('crews.role_fixed')]]);
            }

            if ($target->role !== $role) {
                $before = $target->role;
                $this->memberships->setRole($target, $role);
                Audit::record(CrewAuditEvent::RoleChanged->value, $crew, ['username' => $member->user->username, 'role' => $before->value], ['role' => $role->value], actor: $by);
            }

            return $target->setRelation('user', $member->user);
        });
    }

    public function handOver(User $founder, Crew $crew, CrewMember $member): Crew
    {
        if ($member->crew_id !== $crew->id || $member->user_id === $founder->id) {
            throw ValidationException::withMessages(['username' => [(string) __('crews.hand_over_member')]]);
        }

        // Nit 8: only to an account that can run the crew (not suspended, not closing).
        if (! $member->user->isActive() || $member->user->isPendingDeletion()) {
            throw ValidationException::withMessages(['username' => [(string) __('crews.hand_over_inactive')]]);
        }

        DB::transaction(function () use ($founder, $crew, $member): void {
            // SF-5: the member row first, then the crew, as every other crew write.
            $this->memberships->lockMember($member->user);
            CrewFields::assertActive($this->memberships->lockCrew($crew));
            [$current, $target] = $this->rows($crew, $founder, $member);

            if ($current?->role !== CrewRole::Founder) {
                throw new ApiException(ErrorCode::Forbidden);
            }

            if ($target === null) {
                throw new ApiException(ErrorCode::NotFound);
            }

            $this->memberships->assertMayFound($member->user);
            $this->memberships->setRole($current, CrewRole::Admin);
            $this->memberships->setRole($target, CrewRole::Founder);
            Media::withTrashed()->whereIn('id', array_values(array_filter([$crew->logo_media_id, $crew->cover_media_id])))->where('owner_id', $founder->id)
                ->update(['owner_id' => $member->user_id]);
            Audit::record(CrewAuditEvent::FounderTransferred->value, $crew, ['username' => $founder->username], ['username' => $member->user->username], actor: $founder);
        });

        return $crew;
    }

    /**
     * The actor's and the target's membership rows as they are now (call under the crew lock).
     *
     * @return array{0: CrewMember|null, 1: CrewMember|null}
     */
    private function rows(Crew $crew, User $actor, CrewMember $target): array
    {
        $rows = CrewMember::query()->where('crew_id', $crew->id)->whereIn('user_id', [$actor->id, $target->user_id])->lockForUpdate()->get()->keyBy('user_id');

        return [$rows->get($actor->id), $rows->get($target->user_id)];
    }
}
