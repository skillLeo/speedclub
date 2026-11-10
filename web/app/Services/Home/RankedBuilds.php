<?php

namespace App\Services\Home;

use App\Models\User;
use App\Services\Discover\VisibleBuilds;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;

/**
 * The Für dich rows of one viewer, read through VisibleBuilds (public builds, visible owners, no block either way). Builds walk the
 * index (is_public, rank_score, updated_at[, vehicle_id]) backwards; update rows walk build_updates by created_at.
 */
final class RankedBuilds implements StreamSource
{
    /**
     * @param  'rank_score'|'rank_score_alt'  $column  the score column of the cursor's epoch (HomeRanking::column)
     */
    public function __construct(
        private readonly VisibleBuilds $builds,
        private readonly ?User $viewer,
        private readonly string $column = 'rank_score',
    ) {}

    public function vehiclesAfter(?array $after, array $exclude, int $limit): array
    {
        $query = $this->vehicles()
            ->when($after !== null, fn (Builder $query) => $query->where(fn (Builder $range) => $range
                ->where('vs.'.$this->column, '<', $after[0] ?? '0')
                ->orWhere(fn (Builder $score) => $score->where('vs.'.$this->column, '=', $after[0] ?? '0')->where(fn (Builder $recency) => $recency
                    ->where(VisibleBuilds::CHANGED_AT, '<', $after[1] ?? '')
                    ->orWhere(fn (Builder $tie) => $tie->where(VisibleBuilds::CHANGED_AT, '=', $after[1] ?? '')->where('vs.vehicle_id', '<', $after[2] ?? ''))))))
            ->when($exclude !== [], fn (Builder $query) => $query->whereNotIn('vs.vehicle_id', $exclude))
            ->limit($limit);

        return $this->toVehicles($query);
    }

    public function vehiclesByIds(array $ids): array
    {
        return $ids === [] ? [] : $this->toVehicles($this->vehicles()->whereIn('vs.vehicle_id', $ids));
    }

    public function updatesAfter(?array $after, array $exclude, int $limit): array
    {
        $query = $this->builds->updates($this->viewer)
            // One row per build: its latest visible update.
            ->whereNotExists(fn (Builder $newer) => $newer->selectRaw('1')->from('build_updates', 'bn')
                ->whereColumn('bn.vehicle_id', 'bu.vehicle_id')
                ->where('bn.hidden', false)
                ->where(fn (Builder $later) => $later->whereColumn('bn.created_at', '>', 'bu.created_at')
                    ->orWhere(fn (Builder $tie) => $tie->whereColumn('bn.created_at', '=', 'bu.created_at')->whereColumn('bn.id', '>', 'bu.id'))))
            ->when($after !== null, fn (Builder $query) => $query->where(fn (Builder $range) => $range
                ->where('bu.created_at', '<', $after[0] ?? '')
                ->orWhere(fn (Builder $tie) => $tie->where('bu.created_at', '=', $after[0] ?? '')->where('bu.id', '<', $after[1] ?? ''))))
            ->when($exclude !== [], fn (Builder $query) => $query->whereNotIn('bu.id', $exclude))
            ->select('bu.id', 'bu.vehicle_id', 'vs.owner_id', 'bu.created_at')
            ->orderByDesc('bu.created_at')
            ->orderByDesc('bu.id')
            ->limit($limit);

        return array_values($query->get()->map(fn (object $row): StreamUpdate => new StreamUpdate(
            (string) VisibleBuilds::column($row, 'id'),
            (string) VisibleBuilds::column($row, 'vehicle_id'),
            StreamCursor::ownerKey((string) VisibleBuilds::column($row, 'owner_id')),
            Carbon::parse((string) VisibleBuilds::column($row, 'created_at'))->format('Y-m-d H:i:s'),
        ))->all());
    }

    private function vehicles(): Builder
    {
        return $this->builds->query($this->viewer)
            ->select('vs.vehicle_id', 'vs.owner_id', 'vs.'.$this->column.' as rank_score', 'vs.updated_at')
            ->orderByDesc('vs.'.$this->column)
            ->orderByDesc(VisibleBuilds::CHANGED_AT)
            ->orderByDesc('vs.vehicle_id');
    }

    /**
     * @return list<StreamVehicle>
     */
    private function toVehicles(Builder $query): array
    {
        return array_values($query->get()->map(fn (object $row): StreamVehicle => new StreamVehicle(
            (string) VisibleBuilds::column($row, 'vehicle_id'),
            StreamCursor::ownerKey((string) VisibleBuilds::column($row, 'owner_id')),
            RankScore::format((float) VisibleBuilds::column($row, 'rank_score')),
            Carbon::parse((string) VisibleBuilds::column($row, 'updated_at'))->format('Y-m-d H:i:s'),
        ))->all());
    }
}
