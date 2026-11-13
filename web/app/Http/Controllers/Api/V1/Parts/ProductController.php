<?php

namespace App\Http\Controllers\Api\V1\Parts;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Parts\PartsPageRequest;
use App\Http\Requests\Api\V1\Parts\ProductSearchRequest;
use App\Http\Resources\V1\FeedVehicleResource;
use App\Http\Resources\V1\ProductResource;
use App\Http\Resources\V1\ProductRowResource;
use App\Models\Product;
use App\Services\Parts\PartBuilds;
use App\Services\Parts\ProductPresenter;
use App\Services\Parts\ProductSearch;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * The parts catalogue (09 §8.9, flag `parts_catalogue`): product search and the mod editor's autocomplete, BRD-02 and "Builds mit
 * {Produkt}". Guests too. A product that is gone is 404 product_unavailable; a merged one answers as its survivor.
 */
class ProductController extends Controller
{
    /**
     * Search products.
     *
     * Guests too. The Teile scope of Entdecken (`counts=true` for "In 14 Builds") and the mod editor's autocomplete (`q`, `category`
     * of the mod, `per_page=8`). Active products only, by name; cursor pages.
     *
     * @unauthenticated
     */
    public function index(ProductSearchRequest $request, ProductSearch $search, ProductPresenter $presenter): AnonymousResourceCollection
    {
        Gate::forUser(Viewer::from($request))->authorize('viewAny', Product::class);
        $page = $search->page($request->filters(), $request->pageSize());

        if ($request->boolean('counts')) {
            $presenter->prepare($page->items(), Viewer::from($request));
        }

        return ProductRowResource::collection($page);
    }

    /**
     * Show a product.
     *
     * Guests too. BRD-02: the row with the attributes table, the official link, the affiliate link only while `affiliate_links` is on
     * (labelled "Anzeige", rel="sponsored"), and the real number of builds. An archived product still answers (mods link it); a merged
     * one answers as its survivor (compare `id`).
     *
     * @unauthenticated
     */
    public function show(Request $request, string $product, ProductPresenter $presenter): ProductResource
    {
        $row = $this->find($request, $product);
        $presenter->prepare([$row], Viewer::from($request));

        return new ProductResource($row);
    }

    /**
     * List the builds with a product.
     *
     * Guests too. "Builds mit {Produkt}" (BRD-02, VEH-02 rail): visible builds with a mod linking the product, last changed first;
     * cursor pages.
     *
     * @unauthenticated
     */
    public function builds(PartsPageRequest $request, string $product, PartBuilds $builds): AnonymousResourceCollection
    {
        return FeedVehicleResource::collection($builds->forProduct(Viewer::from($request), $this->find($request, $product), $request->pageSize()));
    }

    private function find(Request $request, string $id): Product
    {
        $product = preg_match('/\A[0-9A-Za-z]{26}\z/', $id) === 1 ? Product::query()->with(['brand', 'category'])->find(strtolower($id)) : null;

        if (! $product instanceof Product) {
            throw new ApiException(ErrorCode::ProductUnavailable);
        }

        Gate::forUser(Viewer::from($request))->authorize('view', $product);

        return ProductPresenter::survivor($product);
    }
}
