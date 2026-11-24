<?php

namespace App\Services\Dex;

use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Contracts\Database\Query\Builder;

/**
 * Ghost mode (10 §16.2, m5.9b contract §5): the owner's opt-in that takes a car out of every list. A ghost car is hidden from search,
 * Discover (lists, facets, make/model pages, similar builds, collections), Home feeds, other members' views of a profile garage, the
 * sitemap and the landing page, and its public page is noindex. It stays reachable by its link and its sticker (/c/{code}), and an
 * in-person spot reveals it with rarity "ghost".
 *
 * One rule in one place, as SampleContent does for samples: every list of builds narrows through constrain() — VisibleBuilds (and with
 * it every Home, Discover, search and collection read), the profile garage (API and Blade), member search's garage line, the profile
 * counts and cover, the sitemap, the landing page — and vehicle_search.is_public is false for a ghost car (VehicleSearchProjector), so
 * a read of the projection alone fails closed too. tests/Feature/Dex/GhostModeTest.php lists the read paths and checks each.
 */
final class GhostMode
{
    public const COLUMN = 'ghost_mode';

    /**
     * Drops ghost cars from a list query. $column is qualified where the query joins vehicles under an alias ("v.ghost_mode").
     *
     * @template TQuery of Builder
     *
     * @param  TQuery  $query
     * @return TQuery
     */
    public static function constrain(Builder $query, string $column = self::COLUMN): Builder
    {
        $query->where($column, false);

        return $query;
    }

    /**
     * Whether a list shown to $viewer leaves $vehicle out: a ghost car, unless it is the viewer's own.
     */
    public static function hides(Vehicle $vehicle, ?User $viewer = null): bool
    {
        return $vehicle->ghost_mode === true && ! $vehicle->isOwnedBy($viewer);
    }
}
