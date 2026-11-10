<?php

namespace App\Http\Controllers\Api\V1\Discover;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Discover\FacetsRequest;
use App\Http\Requests\Api\V1\Discover\InterpretRequest;
use App\Http\Requests\Api\V1\Discover\MemberSearchRequest;
use App\Http\Requests\Api\V1\Discover\SearchRequest;
use App\Http\Resources\V1\FacetsResource;
use App\Http\Resources\V1\FeedVehicleResource;
use App\Http\Resources\V1\InterpretationResource;
use App\Http\Resources\V1\MemberSearchResource;
use App\Http\Resources\V1\SearchOverviewResource;
use App\Models\User;
use App\Models\VehicleSearch;
use App\Services\Discover\QueryInterpreter;
use App\Services\Discover\SearchFacets;
use App\Services\Discover\SearchOverview;
use App\Services\Discover\TextSearch;
use App\Support\Viewer;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * DISC-02 P1-lite: text results (FS-11). Make, model, generation, nickname, engine code, description and installed mods for
 * vehicles; username and display name of discoverable members. "m4", "GT-R", "gtr", "r34" and "E46" find what they name.
 */
class SearchController extends Controller
{
    public function __construct(private readonly TextSearch $search) {}

    /**
     * Search vehicles and members.
     *
     * The first 10 vehicles and 5 members with the totals for the tabs and the cursor to continue with `search/vehicles` or
     * `search/users`.
     *
     * @unauthenticated
     */
    public function index(SearchRequest $request): SearchOverviewResource
    {
        $viewer = Viewer::from($request);
        Gate::forUser($viewer)->authorize('viewAny', VehicleSearch::class);
        Gate::forUser($viewer)->authorize('viewAny', User::class);
        $vehicleWords = $request->vehicleWords();
        // Members are found by text only: with filters alone the tab stays empty.
        $memberWords = $request->memberWords();
        $filters = $request->filters();

        return new SearchOverviewResource(new SearchOverview(
            $request->searchQuery(),
            $this->search->vehicles($viewer, $vehicleWords, config()->integer('speedclub.search.overview_vehicles'), $filters, $request->sort()),
            $this->search->countVehicles($viewer, $vehicleWords, $filters),
            $this->search->members($viewer, $memberWords, config()->integer('speedclub.search.overview_members')),
            $this->search->countMembers($viewer, $memberWords),
        ));
    }

    /**
     * Search vehicles.
     *
     * Public builds only. With `q`: by relevance, then the build changed last; `q` may be left out when a filter or `sort` is set.
     * Filters as in `search/facets`; lists are bracketed (`wheel_diameter[]=19&wheel_diameter[]=20`) and their values are
     * alternatives. A cursor belongs to its text, filters and sort.
     *
     * @unauthenticated
     */
    public function vehicles(SearchRequest $request): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);
        Gate::forUser($viewer)->authorize('viewAny', VehicleSearch::class);

        return FeedVehicleResource::collection($this->search->vehicles($viewer, $request->vehicleWords(), $request->pageSize(), $request->filters(), $request->sort()));
    }

    /**
     * Count the filter options.
     *
     * The facets of the DISC-02 filter sheet for the same parameters as `search/vehicles`: each group counted with every other active
     * filter but not its own, plus the total.
     *
     * @unauthenticated
     */
    public function facets(FacetsRequest $request, SearchFacets $facets): FacetsResource
    {
        $viewer = Viewer::from($request);
        Gate::forUser($viewer)->authorize('viewAny', VehicleSearch::class);

        return new FacetsResource($facets->for($viewer, $request->vehicleWords(), $request->filters()));
    }

    /**
     * Understand a query.
     *
     * Catalogue filters in a typed query ("bmw m4 19 zoll" → BMW, M4, 19″) as chips, and the words left for the text search. Works
     * from the catalogue and fixed patterns only; nothing is applied on the server.
     *
     * @unauthenticated
     */
    public function interpret(InterpretRequest $request, QueryInterpreter $interpreter): InterpretationResource
    {
        $viewer = Viewer::from($request);
        Gate::forUser($viewer)->authorize('viewAny', VehicleSearch::class);

        return new InterpretationResource($interpreter->interpret($request->searchQuery()));
    }

    /**
     * Search members.
     *
     * Discoverable members only, by relevance, then username.
     *
     * @unauthenticated
     */
    public function users(MemberSearchRequest $request): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);
        Gate::forUser($viewer)->authorize('viewAny', User::class);

        return MemberSearchResource::collection($this->search->members($viewer, $request->memberWords(), $request->pageSize()));
    }
}
