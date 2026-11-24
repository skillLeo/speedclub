<?php

namespace App\Services\Wrapped\Cards;

use App\Enums\Rarity;
use App\Models\Vehicle;
use App\Services\Dex\DexQuery;
use App\Services\Garage\VehiclePresenter;
use App\Services\Wrapped\WrappedContext;
use Illuminate\Database\Query\Builder;

/**
 * Card 2: the member's spots of the season and the rarest find (contract §3). Counted, not removed spots of cars the member may still
 * see (DexQuery::found: not deleted, not private, no block either way, owner active and verified, samples per the flag), never of a
 * ghost car (it stays out of every shared surface). City names only, at most `wrapped.max_cities`, of day spots only (never a city of
 * a night spot) and never of a car whose owner hides its cities. No coordinates exist anywhere; no other member is named.
 */
final class SpotsCard implements WrappedCard
{
    public function __construct(
        private readonly DexQuery $dex,
        private readonly VehiclePresenter $presenter,
    ) {}

    public function kind(): string
    {
        return 'spots';
    }

    public function build(WrappedContext $context): ?array
    {
        $count = (int) $this->spots($context)->count();

        if ($count === 0) {
            return null;
        }

        return [
            'kind' => 'spots',
            'count' => $count,
            'unique_cars' => (int) $this->spots($context)->distinct()->count('s.vehicle_id'),
            'cities' => $this->cities($context),
            'rarest' => $this->rarest($context),
        ];
    }

    private function spots(WrappedContext $context): Builder
    {
        return $this->dex->found($context->member)
            ->where('v.ghost_mode', false)
            ->where('s.created_at', '>=', $context->season->fromUtc())
            ->where('s.created_at', '<=', $context->untilUtc());
    }

    /**
     * @return list<string>
     */
    private function cities(WrappedContext $context): array
    {
        return array_values($this->spots($context)
            ->join('de_cities as c', 'c.id', '=', 's.city_id')
            ->where('s.is_night', false)
            ->where('v.hide_spot_cities', false)
            ->groupBy('c.id', 'c.name')
            ->orderByRaw('COUNT(*) DESC')
            ->orderBy('c.name')
            ->limit(config()->integer('speedclub.wrapped.max_cities'))
            ->pluck('c.name')
            ->map(fn (mixed $name): string => (string) $name)
            ->all());
    }

    /**
     * The rarest car found in the season: highest tier, then the lowest Dex number, then the earliest find.
     *
     * @return array{vehicle_id: string, dex_number: int|null, rarity: string, vehicle_name: string, make: string|null, generation: string|null}|null
     */
    private function rarest(WrappedContext $context): ?array
    {
        $rows = $this->spots($context)
            ->groupBy('s.vehicle_id', 'v.rarity', 'v.dex_number')
            ->selectRaw('s.vehicle_id as vehicle_id, v.rarity as rarity, v.dex_number as dex_number, MIN(s.id) as first_spot')
            ->get();

        $best = $rows->sort(function (object $a, object $b): int {
            $rank = fn (object $row): int => (Rarity::tryFrom((string) ($row->rarity ?? '')) ?? Rarity::Street)->rank();
            $dex = fn (object $row): int => is_numeric($row->dex_number ?? null) ? (int) $row->dex_number : PHP_INT_MAX;

            return [$rank($b), $dex($a), (string) $a->first_spot] <=> [$rank($a), $dex($b), (string) $b->first_spot];
        })->first();

        $vehicle = $best === null ? null : Vehicle::query()->with(['make', 'vehicleModel', 'generation'])->find($best->vehicle_id);

        if (! $vehicle instanceof Vehicle) {
            return null;
        }

        return [
            'vehicle_id' => $vehicle->id,
            'dex_number' => $vehicle->dex_number,
            'rarity' => ($vehicle->rarity ?? Rarity::Street)->value,
            'vehicle_name' => $this->presenter->fullTitle($vehicle),
            'make' => $this->presenter->makeName($vehicle),
            'generation' => $vehicle->generation?->name,
        ];
    }
}
