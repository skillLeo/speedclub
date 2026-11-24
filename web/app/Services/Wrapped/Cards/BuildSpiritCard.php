<?php

namespace App\Services\Wrapped\Cards;

use App\Enums\BuildUpdateType;
use App\Enums\EventType;
use App\Enums\ModStatus;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use App\Services\Wrapped\BuildSpiritRules;
use App\Services\Wrapped\WrappedContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Card 7: the member's "Build Spirit" (contract §4, rules in BuildSpiritRules). The mod mix is the member's installed, not deleted mods
 * of the season (installed in it, or added in it without a date); with fewer than `wrapped.spirit.min_season_mods` of those, the
 * whole build's installed mods. `basis` says which: a Wrapped needs season activity, and a spirit from the whole build alone is none.
 * Stored as the key and its numbers; title and explanation come from lang/{de,en}/wrapped.php per request.
 *
 * Its photo (ADR-516 a, `media_id`, handed out by WrappedPayloadBuilder::assignPhotos) is of the car the spirit is about: the
 * classic for Restomod Romantic; for a mix spirit the car with the most counted mods of the spirit's group (same window as the mix); for Daily Hero the car with the most
 * maintenance logs of the season; for Track Day Tactician (decided by meets, not parts) the car with the most counted mods, else the
 * main car. A tie goes to the main car, then the older id. No usable photo of that car: no photo (never another car's).
 */
final class BuildSpiritCard implements WrappedCard
{
    public function __construct(
        private readonly BuildSpiritRules $rules,
        private readonly VehiclePresenter $presenter,
    ) {}

    public function kind(): string
    {
        return 'build_spirit';
    }

    public function build(WrappedContext $context): ?array
    {
        $cars = $context->carIds();
        $trackDays = (int) TreffenCard::attended($context)->where('e.type', EventType::TrackDay->value)->count();

        if ($cars === [] && $trackDays === 0) {
            return null;
        }

        $seasonByCar = $this->categories($context, $cars, true);
        $seasonMods = array_sum(self::total($seasonByCar));
        $fromSeason = $seasonMods >= config()->integer('speedclub.wrapped.spirit.min_season_mods');
        $byCar = $fromSeason ? $seasonByCar : $this->categories($context, $cars, false);
        $logsByCar = $cars === [] ? [] : DB::table('maintenance_logs')
            ->whereIn('vehicle_id', $cars)
            ->whereBetween('done_at', [$context->season->fromDate(), $context->season->toDate()])
            ->groupBy('vehicle_id')
            ->selectRaw('vehicle_id, COUNT(*) as logs')
            ->pluck('logs', 'vehicle_id')
            ->map(fn (mixed $count): int => (int) $count)
            ->all();
        $restomod = $this->restomod($context);

        $decided = $this->rules->decide(
            self::total($byCar),
            $trackDays,
            array_sum($logsByCar),
            $seasonMods,
            $this->activeMonths($context, $cars),
            $restomod === null ? null : ['car' => $restomod['car'], 'year' => $restomod['year'], 'mods' => $restomod['mods']],
        );

        if ($decided === null) {
            return null;
        }

        $seasonal = $fromSeason || in_array($decided['key'], ['daily_hero', 'track_day_tactician'], true);
        $car = $this->spiritCar($decided['key'], $context, $byCar, $logsByCar, $restomod['id'] ?? null);

        if ($car !== null) {
            $context->photoCars['build_spirit'] = $car;
        }

        return ['kind' => 'build_spirit', 'key' => $decided['key'], 'params' => $decided['params'], 'basis' => $seasonal ? 'season' : 'build'];
    }

    /**
     * The car the decided spirit is about (see the class comment).
     *
     * @param  array<string, array<string, int>>  $byCar  counted mods per car and category key
     * @param  array<string, int>  $logsByCar  maintenance logs of the season per car
     */
    private function spiritCar(string $key, WrappedContext $context, array $byCar, array $logsByCar, ?string $restomod): ?Vehicle
    {
        /** @var array<string, list<string>> $groups */
        $groups = config()->array('speedclub.wrapped.spirit.groups');
        $mods = fn (?array $only): array => array_map(
            fn (array $categories): int => array_sum($only === null ? $categories : array_intersect_key($categories, array_flip($only))),
            $byCar,
        );

        return match (true) {
            $key === 'restomod_romantic' => $restomod === null ? null : $context->car($restomod),
            isset($groups[$key]) => $this->most($context, $mods($groups[$key])),
            $key === 'daily_hero' => $this->most($context, $logsByCar),
            $key === 'track_day_tactician' => $this->most($context, $mods(null))
                ?? $context->cars->first(fn (Vehicle $car): bool => $car->is_main),
            default => null,
        };
    }

    /**
     * The member's car with the highest value above 0 (a tie: the main car, then the older id), or null.
     *
     * @param  array<string, int>  $values  per car id
     */
    private function most(WrappedContext $context, array $values): ?Vehicle
    {
        $best = null;

        foreach ($context->cars as $car) {
            $key = [$values[$car->id] ?? 0, $car->is_main ? 1 : 0];

            if ($key[0] > 0 && ($best === null || $key > $best['key'])) {
                $best = ['key' => $key, 'car' => $car];
            }
        }

        return $best['car'] ?? null;
    }

    /**
     * Counted mods per category key over all cars.
     *
     * @param  array<string, array<string, int>>  $byCar
     * @return array<string, int>
     */
    private static function total(array $byCar): array
    {
        $total = [];

        foreach ($byCar as $categories) {
            foreach ($categories as $category => $count) {
                $total[$category] = ($total[$category] ?? 0) + $count;
            }
        }

        return $total;
    }

    /**
     * Installed mods per car and category key.
     *
     * @param  list<string>  $cars
     * @return array<string, array<string, int>>
     */
    private function categories(WrappedContext $context, array $cars, bool $seasonOnly): array
    {
        if ($cars === []) {
            return [];
        }

        $season = $context->season;
        $rows = DB::table('modifications as m')
            ->join('mod_categories as c', 'c.id', '=', 'm.category_id')
            ->whereIn('m.vehicle_id', $cars)
            ->whereNull('m.deleted_at')
            ->where('m.status', ModStatus::Installed->value)
            ->when($seasonOnly, fn (Builder $query) => $query->where(fn (Builder $window) => $window
                ->whereBetween('m.installed_on', [$season->fromDate(), $season->toDate()])
                ->orWhere(fn (Builder $undated) => $undated->whereNull('m.installed_on')->whereBetween('m.created_at', [$season->fromUtc(), $context->untilUtc()]))))
            ->groupBy('m.vehicle_id', 'c.key')
            ->selectRaw('m.vehicle_id as vehicle_id, c.key as category, COUNT(*) as mods')
            ->get();
        $byCar = [];

        foreach ($rows as $row) {
            $byCar[(string) $row->vehicle_id][(string) $row->category] = (int) $row->mods;
        }

        return $byCar;
    }

    /**
     * Berlin months of the season with a maintenance log or an update the member wrote.
     *
     * @param  list<string>  $cars
     */
    private function activeMonths(WrappedContext $context, array $cars): int
    {
        if ($cars === []) {
            return 0;
        }

        $zone = config()->string('speedclub.wrapped.timezone');
        $months = DB::table('maintenance_logs')
            ->whereIn('vehicle_id', $cars)
            ->whereBetween('done_at', [$context->season->fromDate(), $context->season->toDate()])
            ->pluck('done_at')
            ->map(fn (mixed $day): string => substr((string) $day, 0, 7))
            ->all();

        $updates = DB::table('build_updates')
            ->whereIn('vehicle_id', $cars)
            ->where('hidden', false)
            ->whereIn('type', [BuildUpdateType::Post->value, BuildUpdateType::Note->value])
            ->whereBetween('created_at', [$context->season->fromUtc(), $context->untilUtc()])
            ->pluck('created_at');

        foreach ($updates as $at) {
            $months[] = CarbonImmutable::parse((string) $at, 'UTC')->setTimezone($zone)->format('Y-m');
        }

        return count(array_unique($months));
    }

    /**
     * The member's car of model year ≤ `restomod.max_year` with the most installed mods (then the older id).
     *
     * @return array{id: string, car: string, year: int, mods: int}|null
     */
    private function restomod(WrappedContext $context): ?array
    {
        $maxYear = config()->integer('speedclub.wrapped.spirit.restomod.max_year');
        $classics = $context->cars->filter(fn (Vehicle $car): bool => $car->model_year !== null && $car->model_year <= $maxYear);

        if ($classics->isEmpty()) {
            return null;
        }

        $counts = DB::table('modifications')
            ->whereIn('vehicle_id', $classics->pluck('id')->all())
            ->whereNull('deleted_at')
            ->where('status', ModStatus::Installed->value)
            ->groupBy('vehicle_id')
            ->selectRaw('vehicle_id, COUNT(*) as mods')
            ->pluck('mods', 'vehicle_id');

        $best = $classics->sortBy([fn (Vehicle $a, Vehicle $b): int => (int) ($counts[$b->id] ?? 0) <=> (int) ($counts[$a->id] ?? 0), ['id', 'asc']])->first();

        if (! $best instanceof Vehicle || (int) ($counts[$best->id] ?? 0) === 0) {
            return null;
        }

        return ['id' => $best->id, 'car' => $this->presenter->shortTitle($best) ?? $this->presenter->fullTitle($best), 'year' => (int) $best->model_year, 'mods' => (int) $counts[$best->id]];
    }
}
