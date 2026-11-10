<?php

namespace App\Http\Controllers\Api\V1\Discover;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Discover\NewBuildsRequest;
use App\Http\Resources\V1\FeaturedBuildResource;
use App\Http\Resources\V1\FeedVehicleResource;
use App\Http\Resources\V1\HomeModulesResource;
use App\Models\VehicleSearch;
use App\Services\Discover\HomeFeed;
use App\Services\Home\HomeModules;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * HOME-01 "Für dich" (FS-2). Guests and members see the same builds, minus blocks; the stream and "Folge ich" are GET feed (M2.2).
 */
class HomeController extends Controller
{
    public function __construct(
        private readonly HomeFeed $feed,
        private readonly HomeModules $modules,
    ) {}

    /**
     * List the featured builds.
     *
     * At most three, each with a photo and a different owner: the curated list first, then the most complete public builds.
     * The hero shows the first.
     *
     * @unauthenticated
     */
    public function featured(Request $request): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);
        Gate::forUser($viewer)->authorize('viewAny', VehicleSearch::class);

        return FeaturedBuildResource::collection($this->feed->featured($viewer));
    }

    /**
     * List the new builds.
     *
     * Public builds, most recently published or changed first; a change to specs, mods or photos moves a build up.
     *
     * @unauthenticated
     */
    public function newBuilds(NewBuildsRequest $request): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);
        Gate::forUser($viewer)->authorize('viewAny', VehicleSearch::class);

        return FeedVehicleResource::collection($this->feed->newBuilds($viewer, $request->pageSize()));
    }

    /**
     * The modules between Neue Builds and the stream.
     *
     * Build-Updates (at most 3: one per build, two per owner), Aktive Mitglieder (members with a public build changed in the last
     * 14 days, at most 12) and Beliebte Mods diese Woche (brands and parts added to public builds of at least two owners, at most 12). An
     * empty list hides its section.
     *
     * @unauthenticated
     */
    public function modules(Request $request): HomeModulesResource
    {
        $viewer = Viewer::from($request);
        Gate::forUser($viewer)->authorize('viewAny', VehicleSearch::class);

        return new HomeModulesResource([
            'build_updates' => $this->modules->buildUpdates($viewer),
            'active_members' => $this->modules->activeMembers($viewer, config()->integer('speedclub.home.active_members')),
            'popular_mods' => $this->modules->popularMods($viewer),
        ]);
    }
}
