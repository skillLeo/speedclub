<?php

namespace App\Services\Dex;

use App\Enums\DexSetKind;
use App\Models\DexSet;
use App\Models\Make;
use App\Models\Spot;
use App\Models\User;
use App\Models\UserSetProgress;
use App\Models\Vehicle;
use App\Services\Progress\XpHooks;
use App\Support\Slug;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * STREET DEX sets (10 §16.2, m5.9b contract §1, §3, §10): JDM Legends (one slot per generation of the rule), brand sets (5 / 10 / 25
 * different cars of one make, a set per make created at its first spot), the city set (10 different cars in one city) and the season
 * sets (different cars spotted inside a month-day window of the current year). Progress is read live from the member's Dex (DexQuery,
 * the same visibility) and stored in user_set_progress on every counted spot (refresh) for the badges and XP of M5.9d and the nightly
 * repair of part 2.
 */
final class DexSets
{
    /** @var array<string, list<int>> */
    private array $generationIds = [];

    public function __construct(private readonly DexQuery $dex) {}

    /**
     * The sets DexSetSeeder writes (brand sets come per make, brandSet()).
     *
     * @return list<array{key: string, name_de: string, name_en: string, kind: DexSetKind, rule_json: array<string, mixed>, starts_on: string|null, ends_on: string|null, sort: int}>
     */
    public static function definitions(): array
    {
        $sets = [[
            'key' => 'jdm-legends',
            'name_de' => 'JDM Legends',
            'name_en' => 'JDM Legends',
            'kind' => DexSetKind::Jdm,
            'rule_json' => ['generations' => config()->array('speedclub.dex.sets.jdm_legends')],
            'starts_on' => null,
            'ends_on' => null,
            'sort' => 10,
        ], [
            'key' => 'stadtkenner',
            'name_de' => 'Stadtkenner',
            'name_en' => 'City regular',
            'kind' => DexSetKind::City,
            'rule_json' => ['target' => config()->integer('speedclub.dex.sets.city_target')],
            'starts_on' => null,
            'ends_on' => null,
            'sort' => 20,
        ]];

        $names = ['saisonstart' => ['Saisonstart', 'Season opener'], 'saison' => ['Saison', 'Season']];
        $sort = 30;

        foreach (config()->array('speedclub.dex.sets.seasons') as $key => $season) {
            $sets[] = [
                'key' => (string) $key,
                'name_de' => $names[$key][0] ?? (string) $key,
                'name_en' => $names[$key][1] ?? (string) $key,
                'kind' => DexSetKind::Season,
                'rule_json' => ['target' => (int) $season['target']],
                'starts_on' => (string) $season['starts_on'],
                'ends_on' => (string) $season['ends_on'],
                'sort' => $sort++,
            ];
        }

        return $sets;
    }

    /**
     * The brand set of a catalogue make, created on its first use.
     */
    public function brandSet(Make $make): DexSet
    {
        $key = 'brand-'.$make->slug;
        $set = DexSet::query()->find($key);

        if ($set instanceof DexSet) {
            return $set;
        }

        DexSet::query()->insertOrIgnore([[
            'key' => $key,
            'name_de' => $make->name.'-Sammler',
            'name_en' => $make->name.' collector',
            'kind' => DexSetKind::Brand->value,
            'rule_json' => json_encode(['make' => $make->slug, 'tiers' => config()->array('speedclub.dex.sets.brand_tiers')], JSON_THROW_ON_ERROR),
            'hidden' => false,
            'sort' => 100,
            'created_at' => now(),
            'updated_at' => now(),
        ]]);

        return DexSet::query()->findOrFail($key);
    }

    /**
     * After a counted spot of $vehicle: stores the progress of every set the spot can move and returns the ones that moved.
     *
     * @return list<array{key: string, name: string, progress: int, target: int, completed: bool}>
     */
    public function refresh(User $spotter, Vehicle $vehicle): array
    {
        $sets = DexSet::query()->where('hidden', false)->where('kind', '!=', DexSetKind::Brand->value)->get();
        $make = $vehicle->make;

        if ($make instanceof Make) {
            $sets->push($this->brandSet($make));
        }

        $moved = [];

        foreach ($sets as $set) {
            $stored = $this->store($spotter, $set);

            if ($stored !== null && $stored['changed']) {
                $moved[] = $stored['row'];
            }
        }

        return $moved;
    }

    /**
     * The nightly repair (DexNightly): stores the progress of every set the member has or could have progress in, from their Dex as it
     * reads now. A car that left it (its owner deleted the account or the car, went private, a block) lowers the stored progress; a
     * completed set keeps its completed_at (the badge of M5.9d stays earned). Returns how many stored rows changed.
     */
    public function repair(User $member): int
    {
        $sets = DexSet::query()->where('hidden', false)->where('kind', '!=', DexSetKind::Brand->value)->get();
        $keys = UserSetProgress::query()->where('user_id', $member->id)->distinct()->pluck('set_key')->all();
        $found = $this->found($member)->join('makes as mk', 'mk.id', '=', 'v.make_id')->distinct()->pluck('mk.id')->all();

        foreach (Make::query()->whereKey($found)->get() as $make) {
            $keys[] = $this->brandSet($make)->key;
        }

        $sets = $sets->merge(DexSet::query()->where('hidden', false)->where('kind', DexSetKind::Brand->value)->whereIn('key', array_unique($keys))->get());
        $changed = 0;

        foreach ($sets as $set) {
            $changed += ($this->store($member, $set)['changed'] ?? false) ? 1 : 0;
        }

        return $changed;
    }

    /**
     * SEC-P5G-05: the member's completed sets that the cars $vehicleIds count for right now (their stored period is the current one).
     * RemoveSpots asks this before it removes spots, so it can tell afterwards which completions rested on them.
     *
     * @param  list<string>  $vehicleIds
     * @return list<array{set: DexSet, period: string}>
     */
    public function completedWith(User $member, array $vehicleIds): array
    {
        $vehicleIds = array_map(strtolower(...), $vehicleIds);
        $rows = UserSetProgress::query()->where('user_id', $member->id)->whereNotNull('completed_at')->get();
        $sets = DexSet::query()->whereKey($rows->pluck('set_key')->unique()->values()->all())->get()->keyBy('key');
        $found = [];

        foreach ($rows as $row) {
            $set = $sets->get($row->set_key);

            if (! $set instanceof DexSet) {
                continue;
            }

            $progress = $this->progressOf($member, $set);

            if ($progress->period === $row->period && array_intersect(array_map(strtolower(...), $progress->vehicleIds), $vehicleIds) !== []) {
                $found[] = ['set' => $set, 'period' => $row->period];
            }
        }

        return $found;
    }

    /**
     * SEC-P5G-05, the contract's "except for abuse": after staff removed spots, each of $candidates (completedWith() before the removal)
     * that is no longer complete loses its completion and its set XP (XpHooks::setRevoked). Any other loss (a car went private, a block)
     * never takes a completion back (repair()). Returns the revoked set keys ("key" or "key:period").
     *
     * @param  list<array{set: DexSet, period: string}>  $candidates
     * @return list<string>
     */
    public function revokeIncomplete(User $member, array $candidates): array
    {
        $revoked = [];

        foreach ($candidates as $candidate) {
            $progress = $this->progressOf($member, $candidate['set']);

            if ($progress->completed || $progress->period !== $candidate['period']) {
                continue;
            }

            DB::table('user_set_progress')
                ->where('user_id', $member->id)->where('set_key', $candidate['set']->key)->where('period', $candidate['period'])
                ->update(['progress' => $progress->progress, 'target' => $progress->target, 'completed_at' => null, 'updated_at' => now()]);
            app(XpHooks::class)->setRevoked($member, $candidate['set']->key, $candidate['period']);
            $revoked[] = $candidate['period'] === '' ? $candidate['set']->key : $candidate['set']->key.':'.$candidate['period'];
        }

        return $revoked;
    }

    /**
     * Writes the member's current progress of $set; null when there is none to store (no row and no progress).
     *
     * @return array{changed: bool, row: array{key: string, name: string, progress: int, target: int, completed: bool}}|null
     */
    private function store(User $member, DexSet $set): ?array
    {
        $progress = $this->progressOf($member, $set);
        $stored = UserSetProgress::query()->where('user_id', $member->id)->where('set_key', $set->key)->where('period', $progress->period)->first();

        if ($stored === null && $progress->progress === 0) {
            return null;
        }

        $changed = $stored === null || $stored->progress !== $progress->progress || $stored->target !== $progress->target;
        $completedAt = $stored?->getAttribute('completed_at') ?? ($progress->completed ? now() : null);

        if ($stored === null || $changed || ($stored->getAttribute('completed_at') === null && $completedAt !== null)) {
            DB::table('user_set_progress')->upsert([[
                'user_id' => $member->id,
                'set_key' => $set->key,
                'period' => $progress->period,
                'progress' => $progress->progress,
                'target' => $progress->target,
                'completed_at' => $completedAt,
                'updated_at' => now(),
            ]], ['user_id', 'set_key', 'period'], ['progress', 'target', 'completed_at', 'updated_at']);

            // M5.9d: 100 XP once per set and period when it completes now (never taken back, like completed_at).
            if ($completedAt !== null && $stored?->getAttribute('completed_at') === null) {
                app(XpHooks::class)->setCompleted($member, $set->key, $progress->period);
            }
        }

        return ['changed' => $changed, 'row' => [
            'key' => $set->key,
            'name' => $set->name(),
            'progress' => $progress->progress,
            'target' => $progress->target,
            'completed' => $completedAt !== null,
        ]];
    }

    /**
     * The member's Dex as the sets read it: DexQuery::found without sample cars (or sample owners' cars) for a real member (CR-P5G-07,
     * "samples never earn": no set progress, completion or set XP from them; such spots are stored uncounted since the fix, this also
     * covers older rows). A sample member (the staging demo) keeps them.
     */
    private function found(User $member): Builder
    {
        $query = $this->dex->found($member);

        return $member->getAttribute('is_sample') === true ? $query : $query->where('v.is_sample', false)->where('o.is_sample', false);
    }

    /**
     * DEX-05: the sets with their slots. JDM, city and season sets always; a brand set once the member found a car of its make.
     *
     * @return list<SetView>
     */
    public function forUser(User $viewer): array
    {
        $brands = UserSetProgress::query()->where('user_id', $viewer->id)->where('progress', '>', 0)->pluck('set_key')->all();
        $sets = DexSet::query()->where('hidden', false)
            ->where(fn ($query) => $query->where('kind', '!=', DexSetKind::Brand->value)->orWhereIn('key', $brands))
            ->orderBy('sort')->orderBy('key')->get();

        $progress = [];
        $spotIds = [];

        foreach ($sets as $set) {
            $progress[$set->key] = $this->progressOf($viewer, $set);
            $spotIds = [...$spotIds, ...array_slice($progress[$set->key]->spotIds, 0, max(0, $progress[$set->key]->target)), ...array_filter($progress[$set->key]->slotSpots ?? [])];
        }

        $cards = [];

        foreach (app(SpotCards::class)->forSpots($viewer, array_values(array_unique($spotIds))) as $card) {
            if ($card->spot instanceof Spot) {
                $cards[$card->spot->id] = $card;
            }
        }

        $stored = UserSetProgress::query()->where('user_id', $viewer->id)->get()->keyBy(fn (UserSetProgress $row): string => $row->set_key.'|'.$row->period);
        $views = [];

        foreach ($sets as $set) {
            $current = $progress[$set->key];
            $views[] = new SetView(
                $set,
                $current->progress,
                $current->target,
                $stored->get($set->key.'|'.$current->period)?->getAttribute('completed_at'),
                $this->slots($current, $cards),
            );
        }

        return $views;
    }

    public function progressOf(User $viewer, DexSet $set): SetProgress
    {
        return match ($set->kind) {
            DexSetKind::Jdm => $this->jdm($viewer, $set),
            DexSetKind::Brand => $this->brand($viewer, $set),
            DexSetKind::City => $this->city($viewer, $set),
            DexSetKind::Season => $this->season($viewer, $set),
        };
    }

    /**
     * @param  array<string, SpotCard>  $cards
     * @return list<array{found: bool, card: SpotCard|null, silhouette: array{make: string|null, generation: string|null}|null}>
     */
    private function slots(SetProgress $progress, array $cards): array
    {
        if ($progress->slotSpots !== null) {
            $slots = [];

            foreach ($progress->slotSpots as $index => $spotId) {
                $card = $spotId === null ? null : ($cards[$spotId] ?? null);
                $slots[] = ['found' => $card !== null, 'card' => $card, 'silhouette' => $card === null ? ($progress->silhouettes[$index] ?? null) : null];
            }

            return $slots;
        }

        $slots = [];

        foreach (array_slice($progress->spotIds, 0, $progress->target) as $spotId) {
            if (isset($cards[$spotId])) {
                $slots[] = ['found' => true, 'card' => $cards[$spotId], 'silhouette' => null];
            }
        }

        while (count($slots) < $progress->target) {
            $slots[] = ['found' => false, 'card' => null, 'silhouette' => null];
        }

        return $slots;
    }

    private function jdm(User $viewer, DexSet $set): SetProgress
    {
        $rule = $set->rule_json['generations'] ?? [];
        $generations = is_array($rule) ? array_values(array_filter($rule, is_array(...))) : [];
        $found = $this->firstSpots($this->found($viewer)->whereNotNull('v.generation_id'), ['v.generation_id']);
        $slotSpots = [];
        $silhouettes = [];
        $vehicleIds = [];
        $spotIds = [];

        foreach ($generations as $triple) {
            [$make, $model, $generation] = array_map(strval(...), array_pad(array_values($triple), 3, ''));
            $ids = $this->generationIds($make, $model, $generation);
            $hit = null;

            foreach ($found as $row) {
                if (in_array((int) self::col($row, 'generation_id'), $ids, true)) {
                    $hit = $row;
                    break;
                }
            }

            $slotSpots[] = $hit === null ? null : (string) self::col($hit, 'spot_id');
            $silhouettes[] = $this->silhouette($make, $model, $generation);

            if ($hit !== null) {
                $vehicleIds[] = (string) self::col($hit, 'vehicle_id');
                $spotIds[] = (string) self::col($hit, 'spot_id');
            }
        }

        $target = count($generations);
        $progress = count($spotIds);

        return new SetProgress($progress, $target, '', $target > 0 && $progress >= $target, $vehicleIds, $spotIds, $slotSpots, $silhouettes);
    }

    private function brand(User $viewer, DexSet $set): SetProgress
    {
        $slug = (string) ($set->rule_json['make'] ?? '');
        $tiers = array_values(array_filter(array_map(intval(...), (array) ($set->rule_json['tiers'] ?? [])), fn (int $tier): bool => $tier > 0));
        sort($tiers);
        $found = $this->firstSpots($this->found($viewer)->join('makes as mk', 'mk.id', '=', 'v.make_id')->where('mk.slug', $slug), []);
        $progress = count($found);
        $last = $tiers === [] ? 0 : $tiers[count($tiers) - 1];
        $target = $last;

        foreach ($tiers as $tier) {
            if ($progress < $tier) {
                $target = $tier;
                break;
            }
        }

        return $this->result(min($progress, $target), $target, '', $last > 0 && $progress >= $last, $found);
    }

    private function city(User $viewer, DexSet $set): SetProgress
    {
        $target = max(1, (int) ($set->rule_json['target'] ?? 10));
        $best = $this->found($viewer)->whereNotNull('s.city_id')
            ->groupBy('s.city_id')
            ->select('s.city_id')
            ->selectRaw('COUNT(DISTINCT s.vehicle_id) as cars')
            ->orderByDesc('cars')->orderBy('s.city_id')
            ->first();

        if ($best === null) {
            return $this->result(0, $target, '', false, []);
        }

        $found = $this->firstSpots($this->found($viewer)->where('s.city_id', (int) self::col($best, 'city_id')), []);
        $progress = count($found);

        return $this->result(min($progress, $target), $target, '', $progress >= $target, $found);
    }

    private function season(User $viewer, DexSet $set): SetProgress
    {
        $target = max(1, (int) ($set->rule_json['target'] ?? 10));
        $zone = config()->string('speedclub.display_timezone');
        $year = CarbonImmutable::now($zone)->year;
        $from = CarbonImmutable::parse("$year-{$set->starts_on} 00:00:00", $zone)->utc();
        $to = CarbonImmutable::parse("$year-{$set->ends_on} 23:59:59", $zone)->utc();
        $found = $this->firstSpots($this->found($viewer)->whereBetween('s.created_at', [$from, $to]), []);
        $progress = count($found);

        return $this->result(min($progress, $target), $target, (string) $year, $progress >= $target, $found);
    }

    /**
     * @param  list<object>  $found
     */
    private function result(int $progress, int $target, string $period, bool $completed, array $found): SetProgress
    {
        return new SetProgress(
            $progress,
            $target,
            $period,
            $completed,
            array_map(fn (object $row): string => (string) self::col($row, 'vehicle_id'), $found),
            array_map(fn (object $row): string => (string) self::col($row, 'spot_id'), $found),
        );
    }

    /**
     * One row per car of the query (vehicle_id, spot_id = the first spot of it in the query, plus $columns), in the order found.
     *
     * @param  list<string>  $columns
     * @return list<object>
     */
    private function firstSpots(Builder $query, array $columns): array
    {
        $query->columns = null;

        return array_values($query
            ->groupBy(['s.vehicle_id', ...$columns])
            ->select(['s.vehicle_id', ...$columns])
            ->selectRaw('MIN(s.id) as spot_id')
            ->orderBy('spot_id')
            ->get()
            ->all());
    }

    /**
     * @return list<int>
     */
    private function generationIds(string $make, string $model, string $generation): array
    {
        $key = "$make/$model/$generation";

        return $this->generationIds[$key] ??= array_values(array_map(intval(...), DB::table('generations as g')
            ->join('vehicle_models as m', 'm.id', '=', 'g.model_id')
            ->join('makes as k', 'k.id', '=', 'm.make_id')
            ->where('k.slug', $make)->where('m.slug', $model)->where('g.slug', $generation)
            ->pluck('g.id')->all()));
    }

    /**
     * The "???" hint of an unfound JDM slot: the catalogue's make and generation names, else the rule's own words.
     *
     * @return array{make: string|null, generation: string|null}
     */
    private function silhouette(string $make, string $model, string $generation): array
    {
        $row = DB::table('generations as g')
            ->join('vehicle_models as m', 'm.id', '=', 'g.model_id')
            ->join('makes as k', 'k.id', '=', 'm.make_id')
            ->where('k.slug', $make)->where('m.slug', $model)->where('g.slug', $generation)
            ->select(['k.name as make', 'm.name as model', 'g.name as generation'])
            ->first();

        if ($row !== null) {
            return ['make' => (string) self::col($row, 'make'), 'generation' => trim(self::col($row, 'model').' '.self::col($row, 'generation'))];
        }

        return ['make' => ucfirst($make), 'generation' => strtoupper(Slug::make($generation))];
    }

    private static function col(object $row, string $name): string
    {
        $value = get_object_vars($row)[$name] ?? '';

        return is_scalar($value) ? (string) $value : '';
    }
}
