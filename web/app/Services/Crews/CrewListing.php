<?php

namespace App\Services\Crews;

use App\Enums\CrewRole;
use App\Enums\CrewStatus;
use App\Enums\UserStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Http\Resources\V1\VehicleCardResource;
use App\Models\Crew;
use App\Models\CrewMember;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Dex\GhostMode;
use App\Services\Discover\VisibleBuilds;
use App\Services\Showcase\SampleContent;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * The crew lists of contract-crews.md §3: CREW-00 (search by name, Bundesland, A–Z or newest — never by size, C2), a crew's members with
 * their public builds (blocks and invisible accounts left out, C3), a member's crews (the profile chips) and the reader's own crews.
 */
final class CrewListing
{
    public const SORT_NAME = 'name';

    public const SORT_NEWEST = 'newest';

    /** The cursor columns of each list (ValidCursor). */
    public const CURSOR_NAME = ['crews.is_sample', 'crews.name', 'crews.id'];

    public const CURSOR_NEWEST = ['crews.is_sample', 'crews.created_at', 'crews.id'];

    public const CURSOR_MEMBERS = ['crew_members.role_rank', 'crew_members.joined_at', 'crew_members.id'];

    public function __construct(
        private readonly VisibleBuilds $builds,
        private readonly SampleContent $samples,
        private readonly CrewViewerState $viewerState,
    ) {}

    /**
     * Active crews anybody may see: not deleted, not hidden, samples only while they are shown, and never one without a live member
     * (R4DQ-21: a crew whose last account went outside the Actions must not be listed with a count nobody stands behind).
     *
     * @return Builder<Crew>
     */
    public function listable(): Builder
    {
        $query = Crew::query()->where('crews.status', CrewStatus::Active->value)
            ->whereExists(fn (QueryBuilder $live) => $live->selectRaw('1')->from('crew_members as lm')
                ->join('users as lu', 'lu.id', '=', 'lm.user_id')
                ->whereColumn('lm.crew_id', 'crews.id')
                ->whereNull('lu.deleted_at'));
        $this->samples->constrain($query->getQuery(), 'crews.is_sample');

        return $query;
    }

    /**
     * @param  array{q: string|null, bundesland: string|null, sort: string}  $filters
     * @return CursorPaginator<int, Crew>
     */
    public function search(array $filters, ?User $viewer, int $perPage): CursorPaginator
    {
        $query = $this->listable()->with(['logo', 'cover']);

        if ($filters['q'] !== null) {
            $query->where('crews.name', 'like', '%'.addcslashes($filters['q'], '\\%_').'%');
        }

        if ($filters['bundesland'] !== null) {
            $query->where('crews.bundesland', $filters['bundesland']);
        }

        // Real crews first, then samples; never by size (C2).
        $query->orderBy('crews.is_sample');
        $filters['sort'] === self::SORT_NEWEST
            ? $query->orderByDesc('crews.created_at')->orderByDesc('crews.id')
            : $query->orderBy('crews.name')->orderBy('crews.id');

        $page = $query->cursorPaginate($perPage)->withQueryString();
        $this->viewerState->prepare($page->items(), $viewer);

        return $page;
    }

    /**
     * Founder, admins, then members, each by when they joined. Only members the reader may see (publicly visible, no block either way,
     * samples while shown); the reader always sees themselves. Each member's public builds are attached as `crew_vehicles`.
     *
     * @return CursorPaginator<int, CrewMember>
     */
    public function members(Crew $crew, ?User $viewer, int $perPage): CursorPaginator
    {
        $query = CrewMember::query()->select('crew_members.*')
            ->join('users as u', 'u.id', '=', 'crew_members.user_id')
            ->where('crew_members.crew_id', $crew->id)
            ->whereNull('u.deleted_at');

        $query->where(function (Builder $visible) use ($viewer): void {
            $visible->where(fn (Builder $public) => $public->where('u.status', UserStatus::Active->value)->whereNotNull('u.email_verified_at'));

            if ($viewer !== null) {
                $visible->orWhere('u.id', $viewer->id);
            }
        });
        $this->builds->withoutBlocks($query->getQuery(), $viewer, 'u.id');
        $this->samples->constrain($query->getQuery(), 'u.is_sample');

        $page = $query->with(['user.avatar'])
            ->orderBy('crew_members.role_rank')->orderBy('crew_members.joined_at')->orderBy('crew_members.id')
            ->cursorPaginate($perPage)->withQueryString();

        $this->attachVehicles($page->items(), $viewer);

        return $page;
    }

    /**
     * The crews a member is in that the reader may see (active, samples while shown), A–Z, with the member's role as `member_role`.
     *
     * @return Collection<int, Crew>
     */
    public function ofMember(User $member, ?User $viewer): Collection
    {
        $roles = CrewMember::query()->where('user_id', $member->id)->pluck('role', 'crew_id')->all();

        $crews = $this->listable()->with(['logo', 'cover'])->whereIn('crews.id', array_keys($roles))
            ->orderBy('crews.name')->orderBy('crews.id')->get();

        foreach ($crews as $crew) {
            $role = $roles[$crew->id] ?? null;
            $crew->setAttribute('member_role', $role instanceof CrewRole ? $role->value : $role);
        }

        $this->viewerState->prepare($crews, $viewer);

        return $crews;
    }

    /**
     * The reader's own crews in any state but deleted (a hidden one shows its status), A–Z, with open request and invitation counts
     * for the crews they run.
     *
     * @return Collection<int, Crew>
     */
    public function mine(User $user): Collection
    {
        $crews = Crew::query()->with(['logo', 'cover', 'founderMembership.user.avatar'])
            ->whereIn('id', CrewMember::query()->where('user_id', $user->id)->select('crew_id'))
            ->orderBy('name')->orderBy('id')->get();
        $this->viewerState->prepare($crews, $user, counts: true);

        return $crews;
    }

    /**
     * Up to vehicles_per_member public, published builds of each member (main first; a ghost car only for its owner), in one query.
     *
     * @param  array<int, CrewMember>  $members
     */
    public function attachVehicles(array $members, ?User $viewer): void
    {
        if ($members === []) {
            return;
        }

        $limit = max(0, config()->integer('speedclub.crews.vehicles_per_member'));
        $owners = array_values(array_unique(array_map(fn (CrewMember $member): string => $member->user_id, $members)));

        $query = Vehicle::query()->whereIn('owner_id', $owners)
            ->where('status', VehicleStatus::Published)
            ->where('visibility', Visibility::Public)
            ->with(VehicleCardResource::RELATIONS)
            ->withCount('modifications')
            ->orderByDesc('is_main')->orderBy('sort')->orderBy('id');

        if ($viewer === null) {
            GhostMode::constrain($query);
        } else {
            $query->where(fn (Builder $ghost) => $ghost->where('ghost_mode', false)->orWhere('owner_id', $viewer->id));
        }

        $this->samples->constrain($query->getQuery(), 'vehicles.is_sample');
        // Nit 10: the same block filter as the member list, for the single rows of approve and role changes too.
        $this->builds->withoutBlocks($query->getQuery(), $viewer, 'vehicles.owner_id');

        $byOwner = [];

        foreach ($limit === 0 ? [] : $query->get() as $vehicle) {
            if (count($byOwner[$vehicle->owner_id] ?? []) < $limit) {
                $byOwner[$vehicle->owner_id][] = $vehicle;
            }
        }

        foreach ($members as $member) {
            $member->setAttribute('crew_vehicles', $byOwner[$member->user_id] ?? []);
        }
    }

    /**
     * The founder's membership row (with the account).
     */
    public static function founderOf(Crew $crew): ?CrewMember
    {
        return CrewMember::query()->with('user')->where('crew_id', $crew->id)->where('role', CrewRole::Founder->value)->first();
    }
}
