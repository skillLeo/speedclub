<?php

namespace App\Services\Discover;

use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleSearch;
use Illuminate\Database\Query\Builder;

/**
 * "Ähnliche Builds" of VEH-01 [SIG sig.similar_builds] (02_PRODUCT_SPEC §5, m2.3 contract §7). Tiers: the same generation, then the
 * same model, then the same make with a power within ±20 % (speedclub.search.similar_power_share). Within a tier, more shared mod
 * categories with an installed mod first (BIT_COUNT of the masks), then the build changed last, then the id. At most 2 builds per owner,
 * never one of the base build's owner, and only what VisibleBuilds lets the viewer see.
 */
final class SimilarBuilds
{
    /** Candidates read before the per-owner rule thins them out. */
    private const CANDIDATES = 60;

    public function __construct(private readonly VisibleBuilds $builds) {}

    /**
     * @return list<Vehicle>
     */
    public function for(?User $viewer, Vehicle $base): array
    {
        $row = VehicleSearch::query()->find($base->id);
        $makeId = $row?->getAttribute('make_id') ?? $base->getAttribute('make_id');

        if ($makeId === null) {
            return [];
        }

        $modelId = $row?->getAttribute('model_id') ?? $base->getAttribute('model_id');
        $generationId = $row?->getAttribute('generation_id') ?? $base->getAttribute('generation_id');
        $power = $row?->getAttribute('power_ps');
        $mask = (int) ($row?->getAttribute('mod_category_mask') ?? 0);
        $share = (float) config('speedclub.search.similar_power_share');

        $tier = 'CASE';
        $tierBindings = [];

        if ($generationId !== null) {
            $tier .= ' WHEN vs.generation_id = ? THEN 3';
            $tierBindings[] = $generationId;
        }

        if ($modelId !== null) {
            $tier .= ' WHEN vs.model_id = ? THEN 2';
            $tierBindings[] = $modelId;
        }

        $tier .= ' ELSE 1 END';

        $rows = $this->builds->query($viewer)
            ->where('vs.owner_id', '<>', $base->owner_id)
            ->where('vs.vehicle_id', '<>', $base->id)
            ->where(function (Builder $similar) use ($generationId, $modelId, $makeId, $power, $share): void {
                $similar->whereRaw('1 = 0');

                if ($generationId !== null) {
                    $similar->orWhere('vs.generation_id', $generationId);
                }

                if ($modelId !== null) {
                    $similar->orWhere('vs.model_id', $modelId);
                }

                if (is_numeric($power) && (float) $power > 0) {
                    $similar->orWhere(fn (Builder $make) => $make->where('vs.make_id', $makeId)
                        ->whereBetween('vs.power_ps', [(float) $power * (1 - $share), (float) $power * (1 + $share)]));
                }
            })
            ->select('vs.vehicle_id as id', 'vs.owner_id')
            ->selectRaw("($tier) as tier", $tierBindings)
            ->selectRaw('BIT_COUNT(vs.mod_category_mask & ?) as shared', [$mask])
            ->orderByDesc('tier')->orderByDesc('shared')->orderByDesc(VisibleBuilds::CHANGED_AT)->orderByDesc('vs.vehicle_id')
            ->limit(self::CANDIDATES)
            ->get();

        $perOwner = [];
        $ids = [];

        foreach ($rows as $candidate) {
            $owner = (string) VisibleBuilds::column($candidate, 'owner_id');

            if (($perOwner[$owner] ?? 0) >= config()->integer('speedclub.search.similar_builds_per_owner')) {
                continue;
            }

            $perOwner[$owner] = ($perOwner[$owner] ?? 0) + 1;
            $ids[] = (string) VisibleBuilds::column($candidate, 'id');

            if (count($ids) >= config()->integer('speedclub.search.similar_builds')) {
                break;
            }
        }

        $vehicles = $this->builds->vehicles($ids);

        return array_values(array_filter(array_map(fn (string $id): ?Vehicle => $vehicles[$id] ?? null, $ids)));
    }
}
