<?php

namespace App\Http\Controllers\Api\V1\Parts;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Parts\PartsPageRequest;
use App\Http\Resources\V1\BrandPageResource;
use App\Http\Resources\V1\BrandTileResource;
use App\Http\Resources\V1\FeedVehicleResource;
use App\Http\Resources\V1\ProductRowResource;
use App\Models\Brand;
use App\Services\Parts\BrandPages;
use App\Services\Parts\PartBuilds;
use App\Services\Parts\ProductPresenter;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * BRD-01 Marke (09 §7.11, flag `parts_catalogue`) and the brand tiles of Home "Marken im Fokus" and the Teile scope. Guests too. A
 * brand is found by slug (a merged brand's old slug answers its survivor); one without products and builds has no page (404).
 */
class BrandPageController extends Controller
{
    /**
     * List the top part brands.
     *
     * Guests too. "Marken im Fokus" (`per_page=3`) and the Teile scope: catalogue brands by their real number of visible builds, most
     * first, at most 24; brands without a build are left out.
     *
     * @unauthenticated
     */
    public function index(PartsPageRequest $request, PartBuilds $builds): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);
        Gate::forUser($viewer)->authorize('viewAny', Brand::class);
        $limit = min($request->pageSize(), config()->integer('speedclub.parts.top_brands_max'));

        return BrandTileResource::collection($builds->topBrands($viewer, $limit));
    }

    /**
     * Show a brand page.
     *
     * Guests too. Name, about (catalogue), website, real counts of builds and products, and the product lines.
     *
     * @unauthenticated
     */
    public function show(Request $request, string $slug, BrandPages $pages): BrandPageResource
    {
        return new BrandPageResource($pages->page(Viewer::from($request), $this->find($request, $slug)));
    }

    /**
     * List a brand's products.
     *
     * Guests too. Active products of the brand by line and name, with their real build counts; cursor pages.
     *
     * @unauthenticated
     */
    public function products(PartsPageRequest $request, string $slug, BrandPages $pages, ProductPresenter $presenter): AnonymousResourceCollection
    {
        $page = $pages->products($this->find($request, $slug), $request->pageSize());
        $presenter->prepare($page->items(), Viewer::from($request));

        return ProductRowResource::collection($page);
    }

    /**
     * List the builds with a brand.
     *
     * Guests too. "Builds mit {Marke}": visible builds with a mod of the brand, last changed first; cursor pages.
     *
     * @unauthenticated
     */
    public function builds(PartsPageRequest $request, string $slug, PartBuilds $builds): AnonymousResourceCollection
    {
        return FeedVehicleResource::collection($builds->forBrand(Viewer::from($request), $this->find($request, $slug), $request->pageSize()));
    }

    private function find(Request $request, string $slug): Brand
    {
        $brand = app(BrandPages::class)->find($slug);

        if (! $brand instanceof Brand) {
            throw new ApiException(ErrorCode::NotFound);
        }

        Gate::forUser(Viewer::from($request))->authorize('view', $brand);

        return $brand;
    }
}
