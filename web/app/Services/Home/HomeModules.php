<?php

namespace App\Services\Home;

use App\Enums\ModStatus;
use App\Http\Resources\V1\FeedVehicleResource;
use App\Models\BuildUpdate;
use App\Models\Follow;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\HomeFeed;
use App\Services\Discover\VisibleBuilds;
use App\Services\Garage\VehiclePresenter;
use App\Support\HomeClock;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The FS-2 modules between "Neue Builds" and the stream (02_PRODUCT_SPEC §3.8, M2.2): Build-Updates, Aktive Mitglieder, Beliebte Mods.
 * Every one reads through VisibleBuilds, so blocks, private builds and hidden owners never show.
 *
 * Members appear in Aktive Mitglieder and the suggestions only when they are discoverable (as in member search) and let their name be
 * shown next to their builds (show_owner_on_qr, ADR-148 a): the strip pairs a member with a car.
 */
class HomeModules
{
    /** The Neue Builds cards HOME-01 draws above the modules. */
    public const NEW_BUILDS_ABOVE = 2;

    public function __construct(
        private readonly VisibleBuilds $builds,
        private readonly VehiclePresenter $presenter,
        private readonly HomeFeed $home,
    ) {}

    /**
     * The builds HOME-01 draws above the modules for this viewer: the featured hero and the first two Neue Builds. Their latest changes
     * are on the page already, so Build-Updates and the stream leave them out (DQ-308, DQ-289).
     *
     * @return list<string> vehicle ids
     */
    public function shownAbove(?User $viewer): array
    {
        $hero = $this->home->featured($viewer)[0] ?? null;
        $shown = $hero === null ? [] : [$hero->vehicle->id];

        foreach ($this->home->newBuilds($viewer, self::NEW_BUILDS_ABOVE)->items() as $vehicle) {
            /** @var Vehicle $vehicle */
            $shown[] = $vehicle->id;
        }

        return array_values(array_unique($shown));
    }

    /**
     * The newest visible build updates, at most one per build and two per owner, of builds not drawn above the module ($except, by default
     * shownAbove(): DQ-308), so the module fills up to three from other builds.
     *
     * @param  list<string>|null  $except  vehicle ids
     * @return list<BuildUpdate>
     */
    public function buildUpdates(?User $viewer, ?array $except = null): array
    {
        $except ??= $this->shownAbove($viewer);
        $limit = config()->integer('speedclub.home.build_update_rows');
        $batch = $limit * 10;
        $picked = [];
        $vehicles = array_fill_keys($except, true);
        $owners = [];
        $after = null;

        // Each build's latest visible update, newest first, read in batches until three fit the rules or nothing is left (M2.2 review #23):
        // one very active owner can no longer use up a single batch.
        for ($round = 0; $round < 10 && count($picked) < $limit; $round++) {
            $rows = $this->builds->updates($viewer)
                ->whereNotExists(fn (Builder $newer) => $newer->selectRaw('1')->from('build_updates', 'bn')
                    ->whereColumn('bn.vehicle_id', 'bu.vehicle_id')
                    ->where('bn.hidden', false)
                    ->where(fn (Builder $later) => $later->whereColumn('bn.created_at', '>', 'bu.created_at')
                        ->orWhere(fn (Builder $tie) => $tie->whereColumn('bn.created_at', '=', 'bu.created_at')->whereColumn('bn.id', '>', 'bu.id'))))
                ->when($after !== null, fn (Builder $query) => $query->where(fn (Builder $range) => $range
                    ->where('bu.created_at', '<', $after[0] ?? '')
                    ->orWhere(fn (Builder $tie) => $tie->where('bu.created_at', '=', $after[0] ?? '')->where('bu.id', '<', $after[1] ?? ''))))
                ->select('bu.id', 'bu.vehicle_id', 'vs.owner_id', 'bu.created_at')
                ->orderByDesc('bu.created_at')
                ->orderByDesc('bu.id')
                ->limit($batch)
                ->get();

            foreach ($rows as $row) {
                $vehicle = (string) VisibleBuilds::column($row, 'vehicle_id');
                $owner = (string) VisibleBuilds::column($row, 'owner_id');

                if (count($picked) < $limit && ! isset($vehicles[$vehicle]) && ($owners[$owner] ?? 0) < 2) {
                    $picked[] = (string) VisibleBuilds::column($row, 'id');
                    $vehicles[$vehicle] = true;
                    $owners[$owner] = ($owners[$owner] ?? 0) + 1;
                }
            }

            $last = $rows->last();

            if ($last === null || $rows->count() < $batch) {
                break;
            }

            $after = [(string) VisibleBuilds::column($last, 'created_at'), (string) VisibleBuilds::column($last, 'id')];
        }

        $updates = $this->updates($picked);

        return array_values(array_filter(array_map(fn (string $id): ?BuildUpdate => $updates[$id] ?? null, $picked)));
    }

    /**
     * Members with a public build published or changed in the last active_members_days, most recent first; the viewer left out.
     *
     * @param  list<string>  $except  member ids to leave out besides the viewer
     * @return list<ActiveMember>
     */
    public function activeMembers(?User $viewer, int $limit, array $except = []): array
    {
        $since = HomeClock::now()->subDays(config()->integer('speedclub.home.active_members_days'));

        $owners = $this->members($viewer, $except)
            ->where(VisibleBuilds::CHANGED_AT, '>=', $since)
            ->groupBy('vs.owner_id')
            ->selectRaw('vs.owner_id as owner_id, MAX(vs.updated_at) as active_at')
            ->orderByDesc('active_at')
            ->orderByDesc('owner_id')
            ->limit($limit)
            ->pluck('owner_id')
            ->map(strval(...))
            ->all();

        return $this->present($viewer, array_values($owners));
    }

    /**
     * An empty "Folge ich": members with a public build of a make or model the viewer has in the garage, most recently active first, then
     * active members. Never the viewer or somebody already followed.
     *
     * @return list<ActiveMember>
     */
    public function suggestions(User $viewer): array
    {
        $limit = config()->integer('speedclub.home.suggestions');
        $followed = array_values(Follow::query()->where('follower_id', $viewer->id)->pluck('followee_id')->map(strval(...))->all());
        $garage = Vehicle::query()->where('owner_id', $viewer->id)->get(['make_id', 'model_id']);
        $models = $garage->pluck('model_id')->filter()->unique()->values()->all();
        $makes = $garage->pluck('make_id')->filter()->unique()->values()->all();
        $similar = [];

        if ($makes !== [] || $models !== []) {
            $similar = $this->members($viewer, $followed)
                ->where(fn (Builder $query) => $query->whereIn('vs.model_id', $models)->orWhereIn('vs.make_id', $makes))
                ->groupBy('vs.owner_id')
                ->selectRaw(
                    'vs.owner_id as owner_id, MAX(CASE WHEN vs.model_id IN ('.($models === [] ? 'NULL' : implode(',', array_fill(0, count($models), '?'))).') THEN 1 ELSE 0 END) as same_model, MAX(vs.updated_at) as active_at',
                    array_values($models),
                )
                ->orderByDesc('same_model')
                ->orderByDesc('active_at')
                ->orderByDesc('owner_id')
                ->limit($limit)
                ->pluck('owner_id')
                ->map(strval(...))
                ->all();
        }

        $members = $this->present($viewer, array_values($similar));

        if (count($members) < $limit) {
            $members = [...$members, ...$this->activeMembers($viewer, $limit - count($members), array_values([...$followed, ...$similar]))];
        }

        return $members;
    }

    /**
     * Brands and parts most often added as installed mods on public builds in the last popular_mods_days (fallback window when fewer
     * than popular_mods_minimum qualify). A label qualifies with builds of at least popular_mods_min_builds different owners. A brand with
     * a part ("KW V3") first; a brand alone ("BBS") when no part of it qualified. Most builds first, then the label.
     *
     * @return list<PopularMod>
     */
    public function popularMods(?User $viewer): array
    {
        $mods = $this->popularIn($viewer, config()->integer('speedclub.home.popular_mods_days'));

        if (count($mods) < config()->integer('speedclub.home.popular_mods_minimum')) {
            $mods = $this->popularIn($viewer, config()->integer('speedclub.home.popular_mods_fallback_days'));
        }

        return array_slice($mods, 0, config()->integer('speedclub.home.popular_mods'));
    }

    /**
     * Loaded for BuildUpdateRowResource, keyed by id.
     *
     * @param  list<string>  $ids
     * @return array<string, BuildUpdate>
     */
    public function updates(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return BuildUpdate::query()
            ->whereKey($ids)
            ->with(['vehicle' => fn ($query) => $query->with(FeedVehicleResource::RELATIONS)->withCount('modifications')])
            ->get()
            ->keyBy('id')
            ->all();
    }

    /**
     * @return list<PopularMod>
     */
    private function popularIn(?User $viewer, int $days): array
    {
        $rows = $this->builds->constrain(
            DB::table('modifications', 'm')->join('vehicle_search as vs', 'vs.vehicle_id', '=', 'm.vehicle_id', 'straight_join'),
            $viewer,
            'straight_join',
        )
            ->leftJoin('brands as b', 'b.id', '=', 'm.brand_id')
            ->join('mod_categories as c', 'c.id', '=', 'm.category_id')
            ->whereNull('m.deleted_at')
            ->where('m.status', ModStatus::Installed->value)
            ->where('m.created_at', '>=', HomeClock::now()->subDays($days))
            ->orderByDesc('m.created_at')
            ->limit(2000)
            ->get(['m.vehicle_id', 'vs.owner_id', 'b.name as brand_name', 'm.brand_text', 'm.part_name', 'c.key as category_key']);

        /** @var array<string, array{label: string, brand: string, owners: array<string, true>, builds: array<string, true>, categories: array<string, int>}> $combos */
        $combos = [];
        /** @var array<string, array{label: string, brand: string, owners: array<string, true>, builds: array<string, true>, categories: array<string, int>}> $brands */
        $brands = [];

        foreach ($rows as $row) {
            $brand = trim((string) (VisibleBuilds::column($row, 'brand_name') ?? VisibleBuilds::column($row, 'brand_text') ?? ''));

            if ($brand === '') {
                continue;
            }

            $part = trim((string) (VisibleBuilds::column($row, 'part_name') ?? ''));
            $vehicle = (string) VisibleBuilds::column($row, 'vehicle_id');
            $owner = (string) VisibleBuilds::column($row, 'owner_id');
            $category = (string) VisibleBuilds::column($row, 'category_key');

            $this->count($brands, mb_strtolower($brand), $brand, $brand, $vehicle, $owner, $category);

            if ($part !== '') {
                $label = $brand.' '.$part;
                $this->count($combos, mb_strtolower($label), $label, $brand, $vehicle, $owner, $category);
            }
        }

        $minimum = config()->integer('speedclub.home.popular_mods_min_builds');
        $qualified = array_filter($combos, fn (array $entry): bool => count($entry['owners']) >= $minimum);
        $covered = array_flip(array_map(fn (array $entry): string => mb_strtolower($entry['brand']), $qualified));
        $qualified = [
            ...array_values($qualified),
            ...array_values(array_filter($brands, fn (array $entry, string $key): bool => count($entry['owners']) >= $minimum && ! isset($covered[$key]), ARRAY_FILTER_USE_BOTH)),
        ];

        usort($qualified, fn (array $a, array $b): int => [count($b['builds']), $a['label']] <=> [count($a['builds']), $b['label']]);

        return array_map(function (array $entry): PopularMod {
            $categories = $entry['categories'];
            uksort($categories, fn (string $a, string $b): int => [$categories[$b], $a] <=> [$categories[$a], $b]);

            return new PopularMod($entry['label'], array_key_first($categories), $entry['label']);
        }, $qualified);
    }

    /**
     * @param  array<string, array{label: string, brand: string, owners: array<string, true>, builds: array<string, true>, categories: array<string, int>}>  $into
     */
    private function count(array &$into, string $key, string $label, string $brand, string $vehicle, string $owner, string $category): void
    {
        $into[$key] ??= ['label' => $label, 'brand' => $brand, 'owners' => [], 'builds' => [], 'categories' => []];
        $into[$key]['owners'][$owner] = true;
        $into[$key]['builds'][$vehicle] = true;
        $into[$key]['categories'][$category] = ($into[$key]['categories'][$category] ?? 0) + 1;
    }

    /**
     * Visible builds of members who may appear in a member list: discoverable, owner shown, not the viewer, not in $except.
     *
     * @param  list<string>  $except
     */
    private function members(?User $viewer, array $except): Builder
    {
        $except = array_values(array_unique(array_filter([...$except, $viewer?->id])));

        return $this->builds->query($viewer)
            ->where('u.discoverable', true)
            ->where(fn (Builder $query) => $query->whereNull('u.show_owner_on_qr')->orWhere('u.show_owner_on_qr', true))
            ->whereNotNull('u.username')
            ->when($except !== [], fn (Builder $query) => $query->whereNotIn('vs.owner_id', $except));
    }

    /**
     * Members in the given order with their car line ("BMW M4 G82": the main build if it is listed, else the build changed last) and
     * whether the viewer follows them.
     *
     * @param  list<string>  $ids
     * @return list<ActiveMember>
     */
    private function present(?User $viewer, array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $members = User::query()->whereKey($ids)->with('avatar')->get()->keyBy('id');
        $builds = $this->builds->query($viewer)
            ->whereIn('vs.owner_id', $ids)
            ->select('vs.vehicle_id', 'vs.owner_id', 'v.is_main', 'vs.updated_at')
            ->orderByDesc('v.is_main')
            ->orderByDesc('vs.updated_at')
            ->orderByDesc('vs.vehicle_id')
            ->get();
        /** @var Collection<string, string> $carOf */
        $carOf = $builds->groupBy(fn (object $row): string => (string) VisibleBuilds::column($row, 'owner_id'))
            ->map(fn (Collection $rows): string => (string) VisibleBuilds::column((object) $rows->first(), 'vehicle_id'));
        $vehicles = Vehicle::query()->whereKey($carOf->values()->all())->with(['make', 'vehicleModel', 'generation'])->get()->keyBy('id');
        $following = $viewer === null ? [] : array_flip(Follow::query()->where('follower_id', $viewer->id)->whereIn('followee_id', $ids)->pluck('followee_id')->map(strval(...))->all());

        $result = [];

        foreach ($ids as $id) {
            $member = $members->get($id);

            if ($member instanceof User) {
                $vehicle = $vehicles->get($carOf->get($id) ?? '');
                $result[] = new ActiveMember(
                    $member,
                    $vehicle instanceof Vehicle ? $this->presenter->fullTitle($vehicle) : null,
                    isset($following[$id]),
                    $vehicle instanceof Vehicle ? $this->presenter->shortTitle($vehicle) : null,
                );
            }
        }

        return $result;
    }
}
