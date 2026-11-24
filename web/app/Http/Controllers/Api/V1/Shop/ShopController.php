<?php

namespace App\Http\Controllers\Api\V1\Shop;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Shop\ShopProductsRequest;
use App\Http\Resources\V1\Shop\ShopOverviewResource;
use App\Http\Resources\V1\Shop\ShopProductCardResource;
use App\Http\Resources\V1\Shop\ShopProductResource;
use App\Models\ShopProduct;
use App\Services\Shop\ShopCatalogue;
use App\Services\Shop\ShopCatalogueUnavailable;
use App\Services\Shop\ShopCategories;
use App\Services\Shop\ShopLinks;
use App\Support\Viewer;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * SHOP-01/02 (10 §3, ADR-502, m5.5-contract §3), flag `shop` (404 feature_disabled while off). Guests too; the answer is the same for
 * every reader, so it carries one ETag. "Im Shop kaufen" is an https address on the store or the sticker designer's path, built here;
 * payment never happens in the app. A catalogue driver that cannot answer is 503 shop_unavailable.
 */
class ShopController extends Controller
{
    /**
     * Show the shop's head.
     *
     * Guests too. SHOP-01: the hero (the admin's active banner, null when none can be shown), the chips "Alle", Sticker, Kleidung,
     * Accessoires with the real number of products each returns (to hide empty chips; not a visible number), and the store (host and
     * shipping policy link, null while no store is configured).
     *
     * @unauthenticated
     */
    public function index(Request $request, ShopCatalogue $catalogue, ShopLinks $links): ShopOverviewResource
    {
        Gate::forUser(Viewer::from($request))->authorize('viewAny', ShopProduct::class);

        return new ShopOverviewResource($this->read(fn (): array => [
            'hero' => $catalogue->hero(),
            'categories' => $catalogue->categories(),
            'store' => $links->store(),
        ]));
    }

    /**
     * List shop products.
     *
     * Guests too. The SHOP-01 grid in the admin's order, one category or all; cursor pages (default 20, at most 48). Samples (badge
     * "Beispiel") only where sample content is shown. R4-3.2: products of a coming_soon category are never listed; asking for that
     * category answers an empty page with meta.category_status coming_soon, never an error.
     *
     * @unauthenticated
     */
    public function products(ShopProductsRequest $request, ShopCatalogue $catalogue, ShopCategories $categories): AnonymousResourceCollection
    {
        Gate::forUser(Viewer::from($request))->authorize('viewAny', ShopProduct::class);
        $page = $this->read(fn () => $catalogue->products($request->category(), $request->pageSize(), $request->cursor()));
        $url = fn (?string $cursor): ?string => $cursor === null ? null : $request->fullUrlWithQuery(['cursor' => $cursor]);

        return ShopProductCardResource::collection($page->items)->additional([
            'links' => ['first' => null, 'last' => null, 'prev' => $url($page->prevCursor), 'next' => $url($page->nextCursor)],
            'meta' => [
                'path' => $request->url(),
                /** @var int */
                'per_page' => $page->perPage,
                /** @var string|null */
                'next_cursor' => $page->nextCursor,
                /** @var string|null */
                'prev_cursor' => $page->prevCursor,
                /**
                 * R4-3.2: the requested category's status ("available" for "Alle"); a coming_soon category answers an empty page.
                 *
                 * @var 'available'|'coming_soon'
                 */
                'category_status' => $categories->status($request->category())->value,
            ],
        ]);
    }

    /**
     * Show a shop product.
     *
     * Guests too. SHOP-02 by ULID or slug: gallery, price incl. MwSt., variants (each with its own buy link), description, the buy link
     * and the store. 404 shop_product_unavailable when it is unknown, hidden, deleted, in a coming_soon category (R4-3.2), or a sample
     * where samples are not shown.
     *
     * @unauthenticated
     */
    public function show(Request $request, string $product, ShopCatalogue $catalogue): ShopProductResource
    {
        Gate::forUser(Viewer::from($request))->authorize('viewAny', ShopProduct::class);
        $view = $this->read(fn () => $catalogue->product($product));

        if ($view === null) {
            throw new ApiException(ErrorCode::ShopProductUnavailable);
        }

        return new ShopProductResource($view);
    }

    /**
     * @template T
     *
     * @param  Closure(): T  $read
     * @return T
     */
    private function read(Closure $read): mixed
    {
        try {
            return $read();
        } catch (ShopCatalogueUnavailable) {
            throw new ApiException(ErrorCode::ShopUnavailable, headers: ['Retry-After' => '60']);
        }
    }
}
