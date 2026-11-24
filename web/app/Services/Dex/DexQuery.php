<?php

namespace App\Services\Dex;

use App\Enums\Rarity;
use App\Enums\UserStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\DexSet;
use App\Models\User;
use App\Services\Discover\VisibleBuilds;
use App\Services\Showcase\SampleContent;
use Illuminate\Database\Query\Builder;
use Illuminate\Pagination\AbstractCursorPaginator;
use Illuminate\Support\Facades\DB;

/**
 * DEX-01 "Mein Dex" (m5.9b contract §3): the cars a member found, one entry per car (their first counted spot), newest find first.
 * A car leaves the Dex while the member may not see it (deleted, private, a block either way, a hidden owner, a sample while samples are
 * hidden), the same rule as its page. Ghost cars the member found stay: an in-person spot revealed them.
 */
final class DexQuery
{
    public function __construct(
        private readonly VisibleBuilds $builds,
        private readonly SampleContent $samples,
    ) {}

    /**
     * Counted spots of $viewer (as s) joined to their cars (v) and owners (o), only cars the viewer may see.
     */
    public function found(User $viewer): Builder
    {
        $query = DB::table('spots', 's')
            ->join('vehicles as v', 'v.id', '=', 's.vehicle_id')
            ->join('users as o', 'o.id', '=', 'v.owner_id')
            ->where('s.spotter_id', $viewer->id)
            ->where('s.counted', true)
            ->whereNull('s.deleted_at')
            ->whereNull('v.deleted_at')
            ->where('v.status', VehicleStatus::Published->value)
            ->where('v.visibility', '!=', Visibility::Private->value)
            ->whereNull('o.deleted_at')
            ->where('o.status', UserStatus::Active->value)
            ->whereNotNull('o.email_verified_at');

        $this->samples->constrain($query, 'v.is_sample', 'o.is_sample');

        return $this->builds->withoutBlocks($query, $viewer, 'v.owner_id');
    }

    /**
     * One row per found car: vehicle_id and spot_id (the first counted spot; ULIDs sort by time).
     */
    public function entries(User $viewer, ?DexFilter $filter = null): Builder
    {
        $query = $this->found($viewer);

        if ($filter !== null) {
            $this->apply($query, $viewer, $filter);
        }

        return $query->groupBy('s.vehicle_id')->select('s.vehicle_id as vehicle_id')->selectRaw('MIN(s.id) as spot_id');
    }

    /**
     * A page of first-spot ids, newest find first.
     *
     * @return AbstractCursorPaginator<int, object>
     */
    public function page(User $viewer, DexFilter $filter, int $perPage): AbstractCursorPaginator
    {
        /** @var AbstractCursorPaginator<int, object> $page */
        $page = DB::query()->fromSub($this->entries($viewer, $filter), 'd')
            ->orderByDesc('spot_id')
            ->cursorPaginate($perPage, ['vehicle_id', 'spot_id'], 'cursor');

        return $page->withQueryString();
    }

    /**
     * "Dex 87 / 1.240": the cars found, and every car there is to find (public cars others may list, real ones only, plus the ghost cars
     * this member found).
     *
     * @return array{found: int, total: int}
     */
    public function counts(User $viewer): array
    {
        $found = (int) DB::query()->fromSub($this->entries($viewer), 'd')->count();
        $ghosts = (int) $this->found($viewer)->where('v.ghost_mode', true)->distinct()->count('s.vehicle_id');
        $builds = $this->builds->query($viewer);
        // M5.9f: the staging showcase account found sample cars, so off production its total counts the sample cars it may see too
        // (else "57 / 33"); a real member's total stays real cars only.
        $public = ($viewer->getAttribute('is_sample') === true && ! app()->isProduction() ? $builds : VisibleBuilds::realOnly($builds))->count();

        return ['found' => $found, 'total' => $public + $ghosts];
    }

    private function apply(Builder $query, User $viewer, DexFilter $filter): void
    {
        match ($filter->kind) {
            'rarity' => $filter->value === Rarity::Ghost->value
                ? $query->where('v.ghost_mode', true)
                : $query->where('v.ghost_mode', false)->whereRaw('COALESCE(v.rarity, ?) = ?', [Rarity::Street->value, $filter->value]),
            'make' => $query->whereExists(fn (Builder $make) => $make->selectRaw('1')->from('makes as mk')
                ->whereColumn('mk.id', 'v.make_id')->where('mk.slug', $filter->value)),
            'set' => $query->whereIn('s.vehicle_id', $this->setVehicles($viewer, $filter->value)),
            default => null,
        };
    }

    /**
     * @return list<string>
     */
    private function setVehicles(User $viewer, string $key): array
    {
        $set = DexSet::query()->where('hidden', false)->find($key);

        return $set instanceof DexSet ? app(DexSets::class)->progressOf($viewer, $set)->vehicleIds : [];
    }
}
