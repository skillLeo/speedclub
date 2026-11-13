<?php

namespace App\Services\Discover;

use App\Enums\ModStatus;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Services\Garage\VehiclePresenter;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Real-count catalogue strips of M4.8 (09 §7.3, §7.5): "Marken im Fokus" on Home (part brands on the most visible builds as installed
 * mods) and "Beliebte Modelle" on Entdecken (models with the most visible builds). Counts are of the builds the reader may see
 * (VisibleBuilds: blocks, private builds, hidden owners, samples while editorial_samples is off), so nothing is invented. The cover is
 * the newest of those builds' covers.
 */
final class CatalogHighlights
{
    public function __construct(
        private readonly VisibleBuilds $builds,
        private readonly VehiclePresenter $presenter,
    ) {}

    /**
     * @return list<array{slug: string, name: string, vehicle_count: int, cover: Media|null}>
     */
    public function brandsInFocus(?User $viewer, int $limit = 3): array
    {
        $rows = $this->builds->query($viewer)
            ->join('modifications as mo', 'mo.vehicle_id', '=', 'vs.vehicle_id')
            ->join('brands as b', 'b.id', '=', 'mo.brand_id')
            ->whereNull('mo.deleted_at')
            ->where('mo.status', ModStatus::Installed->value)
            ->groupBy('b.id', 'b.slug', 'b.name')
            ->select('b.id', 'b.slug', 'b.name')
            ->selectRaw('COUNT(DISTINCT vs.vehicle_id) as vehicle_count')
            ->orderByDesc('vehicle_count')
            ->orderBy('b.name')
            ->limit($limit)
            ->get();

        $covers = $this->covers($viewer, array_values($rows->pluck('id')->map(intval(...))->all()), fn (Builder $query) => $query
            ->join('modifications as mc', 'mc.vehicle_id', '=', 'vs.vehicle_id')
            ->whereNull('mc.deleted_at')
            ->where('mc.status', ModStatus::Installed->value), 'mc.brand_id');

        return array_values($rows->map(fn (object $row): array => [
            'slug' => (string) $row->slug,
            'name' => (string) $row->name,
            'vehicle_count' => (int) $row->vehicle_count,
            'cover' => $covers[(int) $row->id] ?? null,
        ])->all());
    }

    /**
     * @return list<array{key: string, make: string, name: string, vehicle_count: int, cover: Media|null}>
     */
    public function popularModels(?User $viewer, int $limit = 8): array
    {
        $rows = $this->builds->query($viewer)
            ->whereNotNull('vs.model_id')
            ->groupBy('vs.model_id')
            ->select('vs.model_id')
            ->selectRaw('COUNT(*) as vehicle_count')
            ->orderByDesc('vehicle_count')
            ->orderBy('vs.model_id')
            ->limit($limit)
            ->get();

        $models = VehicleModel::query()->with('make')->whereKey($rows->pluck('model_id')->all())->get()->keyBy('id');
        $covers = $this->covers($viewer, array_values($rows->pluck('model_id')->map(intval(...))->all()), fn (Builder $query) => $query, 'vs.model_id');
        $out = [];

        foreach ($rows as $row) {
            $model = $models->get((int) $row->model_id);

            if (! $model instanceof VehicleModel || $model->make === null) {
                continue;
            }

            $out[] = [
                'key' => ModelKey::of($model),
                'make' => (string) $model->make->getAttribute('name'),
                'name' => (string) $model->getAttribute('name'),
                'vehicle_count' => (int) $row->vehicle_count,
                'cover' => $covers[(int) $model->id] ?? null,
            ];
        }

        return $out;
    }

    /**
     * DISC-03 models[].cover (M4.9).
     *
     * @param  list<int>  $modelIds
     * @return array<int, Media|null>
     */
    public function modelCovers(?User $viewer, array $modelIds): array
    {
        return $this->covers($viewer, $modelIds, fn (Builder $query) => $query, 'vs.model_id');
    }

    /**
     * The newest visible build's cover per group ($column: a brand or a model id), in two queries for all groups (ROW_NUMBER, MySQL 8 and
     * MariaDB 10.6+), so a longer strip costs no more queries.
     *
     * @param  list<int>  $groups
     * @param  \Closure(Builder): mixed  $narrow
     * @param  'mc.brand_id'|'vs.model_id'  $column
     * @return array<int, Media|null>
     */
    private function covers(?User $viewer, array $groups, \Closure $narrow, string $column): array
    {
        if ($groups === []) {
            return [];
        }

        $ranked = $this->builds->query($viewer);
        $narrow($ranked);
        $ranked->whereIn($column, $groups)
            ->select('vs.vehicle_id', $column.' as group_id')
            ->selectRaw($column === 'mc.brand_id'
                ? 'ROW_NUMBER() OVER (PARTITION BY mc.brand_id ORDER BY vs.updated_at DESC, vs.vehicle_id DESC) AS position'
                : 'ROW_NUMBER() OVER (PARTITION BY vs.model_id ORDER BY vs.updated_at DESC, vs.vehicle_id DESC) AS position');
        $picked = DB::query()->fromSub($ranked, 'ranked')->where('position', 1)->pluck('vehicle_id', 'group_id');
        $vehicles = $this->builds->vehicles(array_values(array_map(strval(...), $picked->all())));
        $covers = [];

        foreach ($picked as $group => $vehicleId) {
            $vehicle = $vehicles[(string) $vehicleId] ?? null;
            $covers[(int) $group] = $vehicle instanceof Vehicle ? $this->presenter->cover($vehicle, $vehicle->isOwnedBy($viewer)) : null;
        }

        return $covers;
    }
}
