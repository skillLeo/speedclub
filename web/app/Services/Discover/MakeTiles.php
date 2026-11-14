<?php

namespace App\Services\Discover;

use App\Models\User;

/**
 * "Marken" of DISC-01: every catalogue make with at least one public build the viewer may see, by the number of real builds, then of
 * all visible builds, then by name. The count is of real builds only (DQ-1212, ADR-457): samples (while shown) keep a make listed and
 * break ties, but never add to its number; a make with samples alone shows 0, which the tile prints as no count. Free-text makes ("Nicht gefunden?") have no tile until the admin adds them to the catalogue (ADM-14). Text tiles only: the
 * catalogue holds no manufacturer marks, and 03_DESIGN_SYSTEM §8 rules them out for trademark reasons.
 */
class MakeTiles
{
    public function __construct(private readonly VisibleBuilds $builds) {}

    /**
     * @return list<MakeTile>
     */
    public function for(?User $viewer): array
    {
        $rows = $this->builds->query($viewer)
            ->join('makes as m', 'm.id', '=', 'vs.make_id')
            ->groupBy('m.id', 'm.name', 'm.slug')
            ->select('m.id', 'm.name', 'm.slug')
            ->selectRaw(VisibleBuilds::REAL_COUNT.' as vehicle_count')
            ->selectRaw('COUNT(*) as visible_count')
            ->orderByDesc('vehicle_count')
            ->orderByDesc('visible_count')
            ->orderBy('m.name')
            ->orderBy('m.id')
            ->get();

        return array_values($rows->map(fn (object $row): MakeTile => new MakeTile(
            (int) $row->id,
            (string) $row->name,
            (string) $row->slug,
            (int) $row->vehicle_count,
        ))->all());
    }
}
