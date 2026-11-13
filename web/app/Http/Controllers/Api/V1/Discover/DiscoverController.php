<?php

namespace App\Http\Controllers\Api\V1\Discover;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\DiscoverResource;
use App\Models\DiscoverCollection;
use App\Models\VehicleSearch;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Discover\CatalogHighlights;
use App\Services\Discover\Collections;
use App\Services\Discover\DiscoverPage;
use App\Services\Discover\HomeFeed;
use App\Services\Discover\MakeTiles;
use App\Services\Discover\SimilarMembers;
use App\Services\Events\NearbyEvents;
use App\Services\Home\HomeModules;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * DISC-01 (FS-11): make tiles, Kollektionen, Beliebte Mods and [SIG] Mitglieder mit ähnlichen Autos.
 */
class DiscoverController extends Controller
{
    /** M4.8 DISC-01 "Neu": the newest builds shown. */
    private const NEWEST = 8;

    /**
     * Read the discover page.
     *
     * Make tiles with the real number of public builds the viewer can find, the collections with at least one such build, the popular
     * mods of `home/modules`, and, for a member with a public build while `sig.similar_builds` is on, members with similar cars.
     *
     * @unauthenticated
     */
    public function index(Request $request, MakeTiles $tiles, Collections $collections, HomeModules $modules, SimilarMembers $similar, FeatureFlags $flags, CatalogHighlights $highlights, NearbyEvents $events, HomeFeed $feed): DiscoverResource
    {
        $viewer = Viewer::from($request);
        Gate::forUser($viewer)->authorize('viewAny', VehicleSearch::class);
        Gate::forUser($viewer)->authorize('viewAny', DiscoverCollection::class);

        return new DiscoverResource(new DiscoverPage(
            makes: $tiles->for($viewer),
            collections: $collections->for($viewer),
            popularMods: $modules->popularMods($viewer),
            similarMembers: $flags->enabled('sig.similar_builds') ? $similar->for($viewer) : null,
            popularModels: $highlights->popularModels($viewer),
            weekendEvents: $events->weekend($viewer),
            newest: array_values($feed->newBuilds($viewer, self::NEWEST)->items()),
        ));
    }
}
