<?php

namespace App\Http\Controllers\Api\V1\Discover;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Discover\ModelBuildsRequest;
use App\Http\Requests\Api\V1\Discover\WheelSetupsRequest;
use App\Http\Resources\V1\FeedVehicleResource;
use App\Http\Resources\V1\MakePageResource;
use App\Http\Resources\V1\ModelPageResource;
use App\Http\Resources\V1\WheelSetupResource;
use App\Models\Make;
use App\Models\VehicleModel;
use App\Models\VehicleSearch;
use App\Services\Catalog\CatalogSlugs;
use App\Services\Discover\MakePages;
use App\Services\Discover\ModelKey;
use App\Services\Discover\TextSearch;
use App\Services\Discover\WheelSetups;
use App\Support\Viewer;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * DISC-03 make pages and DISC-04 model collections (m2.3 contract §6). A make or model without a build the viewer can find has no page
 * (404 `not_found`). The slug of a merged make or model (M3.3) answers 301 to its survivor's page. The model route key is "{make}--{model}" ("bmw--m4"), as model slugs repeat across makes (ModelKey).
 */
class CatalogPageController extends Controller
{
    public function __construct(private readonly MakePages $pages) {}

    /**
     * Read a make page.
     *
     * The make with its real number of builds and its models with builds, most first, each with its generations (oldest first).
     *
     * @unauthenticated
     */
    public function make(Request $request, string $make): MakePageResource|RedirectResponse
    {
        $viewer = Viewer::from($request);
        Gate::forUser($viewer)->authorize('viewAny', VehicleSearch::class);
        $row = CatalogSlugs::make($make);

        // M3.3: the slug of a merged make answers its survivor's page, as a 301 to the canonical URL.
        if ($row !== null && $row->slug !== $make) {
            return $this->canonical($request, 'api.v1.discover.makes.show', ['make' => $row->slug]);
        }

        $page = $row === null ? null : $this->pages->make($viewer, $row);

        if ($page === null) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return new MakePageResource($page);
    }

    /**
     * Read a model page.
     *
     * `{model}` is the key "bmw--m4". The model and its make with their real counts, and the generations with builds.
     *
     * @unauthenticated
     */
    public function model(Request $request, string $model): ModelPageResource|RedirectResponse
    {
        $viewer = Viewer::from($request);
        Gate::forUser($viewer)->authorize('viewAny', VehicleSearch::class);
        $row = $this->catalogModel($model);

        if (ModelKey::of($row) !== $model) {
            return $this->canonical($request, 'api.v1.discover.models.show', ['model' => ModelKey::of($row)]);
        }
        $counts = $this->pages->model($viewer, $row);

        if ($counts === null || ! $row->make instanceof Make) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return new ModelPageResource(['model' => $counts, 'make' => $row->make, 'make_count' => $this->pages->makeCount($viewer, $row->make)]);
    }

    /**
     * List the builds of a model.
     *
     * Optionally of one generation. Sorts `newest` (default), `updated`, `power`; cursor pages.
     *
     * @unauthenticated
     */
    public function builds(ModelBuildsRequest $request, TextSearch $search): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);
        Gate::forUser($viewer)->authorize('viewAny', VehicleSearch::class);
        $this->requireModel($request->model());

        return FeedVehicleResource::collection($search->vehicles(
            $viewer, null, $request->pageSize(), $request->filters(), $request->sort(), (string) $request->route()?->getName(),
        ));
    }

    /**
     * List the wheel setups of a model.
     *
     * One row per build with an installed wheel set (its first), newest change first; optionally of one generation.
     *
     * @unauthenticated
     */
    public function wheelSetups(WheelSetupsRequest $request, WheelSetups $setups): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);
        Gate::forUser($viewer)->authorize('viewAny', VehicleSearch::class);
        $this->requireModel($request->model());

        return WheelSetupResource::collection($setups->page($viewer, $request->filters(), $request->signature(), $request->pageSize()));
    }

    /**
     * A permanent redirect to the canonical page, with the query string; clients follow it like any 301.
     *
     * @param  array<string, string>  $parameters
     */
    private function canonical(Request $request, string $route, array $parameters): RedirectResponse
    {
        $query = $request->getQueryString();

        return redirect()->to(route($route, $parameters).($query === null ? '' : '?'.$query), 301);
    }

    private function catalogModel(string $key): VehicleModel
    {
        return ModelKey::find($key) ?? throw new ApiException(ErrorCode::NotFound);
    }

    private function requireModel(?VehicleModel $model): void
    {
        if ($model === null) {
            throw new ApiException(ErrorCode::NotFound);
        }
    }
}
