<?php

namespace App\Services\Discover;

use App\Enums\ModStatus;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Pagination\CursorPaginator as FrameworkCursorPaginator;

/**
 * "Räder-Vergleich" of DISC-04 (brief §5 "compare wheel setups", m2.3 contract §6): one row per visible build of the model (and
 * generation) with an installed wheel set, newest change first. The set is the build's first installed wheels mod with a diameter, in the
 * member's order, as the vehicle page and vehicle_search.wheel_diameter read it; the suspension is its first installed suspension mod.
 * The stored numbers go out as they are; the app formats them (02_PRODUCT_SPEC §3.9).
 */
final class WheelSetups
{
    public function __construct(private readonly VisibleBuilds $builds) {}

    /**
     * @return CursorPaginator<int, WheelSetup>
     */
    public function page(?User $viewer, SearchFilters $filters, string $signature, int $perPage): CursorPaginator
    {
        $hits = $filters->apply($this->builds->query($viewer))
            ->whereNotNull('vs.wheel_diameter')
            ->select('vs.vehicle_id as id', VisibleBuilds::CHANGED_AT.' as sort_at')
            ->selectRaw('? as '.SearchCursor::COLUMN, [$signature]);

        $page = $this->builds->page($hits, [SearchCursor::COLUMN => 'desc', 'sort_at' => 'desc', 'id' => 'desc'], $perPage);

        $vehicles = $page->getCollection();
        $mods = Modification::query()
            ->whereIn('vehicle_id', $vehicles->pluck('id')->all())
            ->where('status', ModStatus::Installed)
            ->whereHas('category', fn ($category) => $category->whereIn('key', ['wheels_tires', 'suspension']))
            ->with(['category.fields', 'brand'])
            ->orderBy('sort')->orderBy('id')
            ->get()
            ->groupBy('vehicle_id');

        $page->setCollection($vehicles->map(function (Vehicle $vehicle) use ($mods): ?WheelSetup {
            $own = $mods->get($vehicle->id, collect());
            $wheels = $own->first(fn (Modification $mod): bool => $mod->category->key === 'wheels_tires' && isset($mod->getAttribute('fields')['diameter']));
            $suspension = $own->first(fn (Modification $mod): bool => $mod->category->key === 'suspension');

            // The projection said there is a set; a mod deleted since leaves the row out of this page.
            return $wheels instanceof Modification ? new WheelSetup($vehicle, $wheels, $suspension instanceof Modification ? $suspension : null) : null;
        })->filter()->values());

        /** @var FrameworkCursorPaginator<int, WheelSetup> $page */
        return $page;
    }
}
