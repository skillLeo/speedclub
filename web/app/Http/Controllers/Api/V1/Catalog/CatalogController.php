<?php

namespace App\Http\Controllers\Api\V1\Catalog;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Catalog\CatalogListRequest;
use App\Http\Requests\Api\V1\Catalog\ListBrandsRequest;
use App\Http\Resources\V1\BrandResource;
use App\Http\Resources\V1\GenerationResource;
use App\Http\Resources\V1\MakeResource;
use App\Http\Resources\V1\ModCategoryResource;
use App\Http\Resources\V1\VehicleModelResource;
use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\ModCategory;
use App\Models\VehicleModel;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * Catalogue reads (05_ARCHITECTURE §7): public, cursor paginated, ETag.
 */
class CatalogController extends Controller
{
    /**
     * List makes, popular ones first.
     *
     * @unauthenticated
     */
    public function makes(CatalogListRequest $request): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Make::class);

        return MakeResource::collection(
            Make::query()
                ->where('active', true)
                ->orderByDesc('is_popular')
                ->orderBy('sort')
                ->orderBy('name')
                ->orderBy('id')
                ->cursorPaginate($request->pageSize())
                ->withQueryString()
        );
    }

    /**
     * List the models of a make.
     *
     * @unauthenticated
     */
    public function models(CatalogListRequest $request, Make $make): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', VehicleModel::class);
        abort_unless($make->active, 404);

        return VehicleModelResource::collection(
            $make->models()
                ->where('active', true)
                ->orderBy('name')
                ->orderBy('id')
                ->cursorPaginate($request->pageSize())
                ->withQueryString()
        );
    }

    /**
     * List the generations of a model.
     *
     * @unauthenticated
     */
    public function generations(CatalogListRequest $request, VehicleModel $model): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Generation::class);
        abort_unless($model->active, 404);

        return GenerationResource::collection(
            $model->generations()
                ->where('active', true)
                ->orderBy('id')
                ->cursorPaginate($request->pageSize())
                ->withQueryString()
        );
    }

    /**
     * List brands, optionally of one modification category.
     *
     * Brands merged into another one are left out.
     *
     * @unauthenticated
     */
    public function brands(ListBrandsRequest $request): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Brand::class);

        return BrandResource::collection(
            Brand::query()
                ->whereNull('merged_into_id')
                ->when($request->validated('category'), fn ($query, $category) => $query->where('category_hint', $category))
                ->orderBy('name')
                ->orderBy('id')
                ->cursorPaginate($request->pageSize())
                ->withQueryString()
        );
    }

    /**
     * List modification categories with their field schemas.
     *
     * Names and labels follow Accept-Language. Archived fields (M3.3) are listed with `archived: true`: shown on existing modifications,
     * not offered for new entries.
     *
     * @unauthenticated
     */
    public function modCategories(CatalogListRequest $request): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', ModCategory::class);

        return ModCategoryResource::collection(
            ModCategory::query()
                ->where('active', true)
                ->with(['fields' => fn ($query) => $query->orderBy('sort')->orderBy('id')])
                ->orderBy('sort')
                ->orderBy('id')
                ->cursorPaginate($request->pageSize())
                ->withQueryString()
        );
    }
}
