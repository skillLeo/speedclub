<?php

namespace App\Http\Controllers\Admin\Shop;

use App\Actions\Admin\Shop\ManageShopProducts;
use App\Enums\ShopCategory;
use App\Enums\ShopPurchaseMode;
use App\Enums\ShopVariantKind;
use App\Http\Controllers\Admin\Shop\Requests\ShopProductRequest;
use App\Http\Controllers\Admin\Shop\Requests\ShopReorderRequest;
use App\Http\Controllers\Admin\Shop\Requests\ShopStateRequest;
use App\Http\Controllers\Admin\Shop\Requests\ShopVisibilityRequest;
use App\Http\Controllers\Admin\Support\ActivityFeed;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\Shop\ShopProductCardResource;
use App\Http\Resources\V1\Shop\ShopProductResource;
use App\Models\ShopProduct;
use App\Models\ShopProductImage;
use App\Models\Staff;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Shop\ShopCatalogue;
use App\Services\Shop\ShopDomain;
use App\Services\Shop\ShopifyStorefrontCatalogue;
use App\Services\Shop\ShopImages;
use App\Services\Shop\ShopLinks;
use App\Services\Shop\ShopPrice;
use App\Services\Shop\ShopViews;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-66 Shop-Produkte (10 §3, m5.5-contract §5): the product table (filters q, category, visible, sample, trashed; sorts sort, title,
 * price, updated), the edit page with photos and the exact member preview, create, edit, show/hide, reorder, delete ⚿ (soft) and
 * restore. Atom shop.manage on every route and in every FormRequest; the delete also needs the recent password (ADR-215).
 */
class ShopProductsController extends Controller
{
    public const TABLE = 'shop-products';

    public function index(Request $request, ShopImages $images, ShopLinks $links): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $base = ShopProduct::query()->withTrashed()->with('images');
        $trashed = TableProps::filters($request)['trashed'] ?? null;

        if ($trashed !== 'only') {
            $base->whereNull('shop_products.deleted_at');
        }

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('q', function (Builder $q, mixed $value): void {
                    $term = is_string($value) ? trim($value) : '';

                    if ($term !== '') {
                        $like = '%'.addcslashes($term, '%_\\').'%';
                        $q->where(fn (Builder $any) => $any->where('shop_products.title', 'like', $like)->orWhere('shop_products.slug', 'like', $like));
                    }
                }),
                AllowedFilter::callback('category', fn (Builder $q, mixed $value) => $q->where('shop_products.category', is_string($value) ? $value : '-'))->delimiter("\u{1}"),
                AllowedFilter::callback('visible', fn (Builder $q, mixed $value) => $q->where('shop_products.visible', in_array($value, ['1', 1, true, 'true'], true)))->delimiter("\u{1}"),
                AllowedFilter::callback('sample', fn (Builder $q, mixed $value) => $q->where('shop_products.is_sample', in_array($value, ['1', 1, true, 'true'], true)))->delimiter("\u{1}"),
                AllowedFilter::callback('trashed', fn (Builder $q, mixed $value) => $value === 'only' ? $q->whereNotNull('shop_products.deleted_at') : $q)->delimiter("\u{1}"),
            )
            ->allowedSorts('sort', 'title', 'price_cents', 'updated_at')
            ->defaultSort('sort');

        $editors = fn (array $ids): array => Staff::query()->whereIn('id', array_values(array_filter(array_unique($ids))))->pluck('name', 'id')->all();

        return Inertia::render('Shop/Products/Index', [
            ...TableProps::make($query, $request, self::TABLE, $staff, function (array $products) use ($images, $links, $editors): array {
                /** @var list<ShopProduct> $products */
                $names = $editors(array_map(fn (ShopProduct $product): ?int => $product->updated_by, $products));

                return array_map(fn (ShopProduct $product): array => self::row($product, $images, $links, $names), $products);
            }, 'sort'),
            'categories' => self::options(ShopCategory::cases()),
            'store' => self::storeProps(),
            'flagOn' => app(FeatureFlags::class)->enabled('shop'),
            'canManage' => $staff->can('shop.manage'),
        ]);
    }

    public function create(Request $request): Response
    {
        return $this->page($request, null);
    }

    public function edit(Request $request, string $product): Response
    {
        return $this->page($request, self::find($product, withTrashed: true));
    }

    public function store(ShopProductRequest $request, ManageShopProducts $products): RedirectResponse|JsonResponse
    {
        $product = $products->add($request->staff(), $request->fields(), $request->reason());

        if ($request->expectsJson() && ! $request->hasHeader('X-Inertia')) {
            return response()->json(['id' => $product->id, 'slug' => $product->slug], 201);
        }

        return redirect()->route('admin.shop.products.edit', ['product' => $product->id], 303)->with('success', 'shop.flash.created');
    }

    public function update(ShopProductRequest $request, string $product, ManageShopProducts $products): RedirectResponse|JsonResponse
    {
        return $this->done($request, $products->change($request->staff(), self::find($product), $request->fields(), $request->reason()), 'updated');
    }

    public function visibility(ShopVisibilityRequest $request, string $product, ManageShopProducts $products): RedirectResponse|JsonResponse
    {
        $visible = $request->boolean('visible');

        return $this->done($request, $products->visibility($request->staff(), self::find($product), $visible, $request->reason()), $visible ? 'shown' : 'hidden');
    }

    public function reorder(ShopReorderRequest $request, ManageShopProducts $products): RedirectResponse|JsonResponse
    {
        $products->reorder($request->staff(), $request->ids(), $request->reason());

        if ($request->expectsJson() && ! $request->hasHeader('X-Inertia')) {
            return response()->json(['ids' => $request->ids()]);
        }

        return back(303)->with('success', 'shop.flash.reordered');
    }

    public function destroy(ShopStateRequest $request, string $product, ManageShopProducts $products): RedirectResponse|JsonResponse
    {
        $model = self::find($product);
        $products->remove($request->staff(), $model, $request->reason());

        if ($request->expectsJson() && ! $request->hasHeader('X-Inertia')) {
            return response()->json(['id' => $model->id, 'deleted' => true]);
        }

        return redirect()->route('admin.shop.products.index', [], 303)->with('success', 'shop.flash.deleted');
    }

    public function restore(ShopStateRequest $request, string $product, ManageShopProducts $products): RedirectResponse|JsonResponse
    {
        return $this->done($request, $products->bringBack($request->staff(), self::find($product, withTrashed: true), $request->reason()), 'restored');
    }

    /**
     * @param  array<int|string, string>  $editors  staff id => name
     * @return array<string, mixed>
     */
    public static function row(ShopProduct $product, ShopImages $images, ShopLinks $links, array $editors = []): array
    {
        $first = $product->images->first();
        $buy = $links->product($product->purchase_mode, $product->shopify_url);

        return [
            'id' => $product->id,
            'slug' => $product->slug,
            'title' => $product->title,
            'category' => $product->category->value,
            'price_cents' => $product->price_cents,
            'price' => ShopPrice::format($product->price_cents, $product->currency),
            'visible' => $product->visible,
            'is_sample' => $product->is_sample,
            'purchase_mode' => $product->purchase_mode->value,
            'buy_state' => $buy->state(),
            'image' => $first === null ? null : ['url' => $images->variantUrl($first, 320), 'blurhash' => $first->blurhash],
            'images_count' => $product->images->count(),
            'variants_count' => count($product->variantList()),
            'sort' => $product->sort,
            'deleted_at' => $product->deleted_at?->toIso8601String(),
            'updated_at' => $product->updated_at?->toIso8601String(),
            'updated_by' => $product->updated_by === null ? null : ($editors[$product->updated_by] ?? null),
        ];
    }

    /**
     * @return array{configured: bool, host: string|null, extra_hosts: list<string>, driver: string, storefront: 'configured'|'not_configured'}
     */
    public static function storeProps(): array
    {
        $domain = app(ShopDomain::class);
        $host = $domain->host();

        return [
            'configured' => $host !== null,
            'host' => $host,
            'extra_hosts' => array_values(array_filter($domain->allowedHosts(), fn (string $candidate): bool => $candidate !== $host)),
            'driver' => app(ShopCatalogue::class)->driver(),
            'storefront' => ShopifyStorefrontCatalogue::tokenConfigured() && $host !== null ? 'configured' : 'not_configured',
        ];
    }

    /**
     * @param  list<ShopCategory|ShopVariantKind|ShopPurchaseMode>  $cases
     * @return list<array{value: string, label: string}>
     */
    public static function options(array $cases): array
    {
        return array_map(fn (ShopCategory|ShopVariantKind|ShopPurchaseMode $case): array => ['value' => $case->value, 'label' => $case->label()], $cases);
    }

    public static function find(string $id, bool $withTrashed = false): ShopProduct
    {
        $query = $withTrashed ? ShopProduct::withTrashed() : ShopProduct::query();
        $product = preg_match('/\A[0-9A-Za-z]{26}\z/', $id) === 1 ? $query->with('images')->find(strtolower($id)) : null;
        abort_if($product === null, 404);

        return $product;
    }

    private function page(Request $request, ?ShopProduct $product): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $images = app(ShopImages::class);

        return Inertia::render('Shop/Products/Edit', [
            'product' => $product === null ? null : self::record($product, $images),
            'preview' => $product === null || $product->images->isEmpty() ? null : self::preview($request, $product),
            'activity' => fn (): array => $product === null ? [] : ActivityFeed::for([$product->getMorphClass() => [$product->id]], $staff),
            'categories' => self::options(ShopCategory::cases()),
            'variantKinds' => self::options(ShopVariantKind::cases()),
            'purchaseModes' => self::options(ShopPurchaseMode::cases()),
            'store' => self::storeProps(),
            'limits' => [
                'max_images' => config()->integer('speedclub.shop.max_images'),
                'max_variants' => config()->integer('speedclub.shop.max_variants'),
                'title_max' => 120,
                'description_max' => 4000,
                'min_crop' => ['width' => (int) config('speedclub.shop.image.product_min.0'), 'height' => (int) config('speedclub.shop.image.product_min.1')],
                'max_upload_kb' => config()->integer('speedclub.shop.image.max_upload_kb'),
            ],
            'canManage' => $staff->can('shop.manage'),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private static function record(ShopProduct $product, ShopImages $images): array
    {
        $purgeAt = $product->deleted_at?->copy()->addDays(config()->integer('speedclub.shop.purge_after_days'));

        return [
            'id' => $product->id,
            'slug' => $product->slug,
            'title' => $product->title,
            'description' => $product->description,
            'category' => $product->category->value,
            'price_cents' => $product->price_cents,
            'currency' => $product->currency,
            'variant_kind' => $product->variant_kind->value,
            'variants' => $product->variantList(),
            'purchase_mode' => $product->purchase_mode->value,
            'shopify_url' => $product->shopify_url,
            'visible' => $product->visible,
            'is_sample' => $product->is_sample,
            'sort' => $product->sort,
            'deleted_at' => $product->deleted_at?->toIso8601String(),
            'purge_at' => $purgeAt?->toIso8601String(),
            'created_at' => $product->created_at?->toIso8601String(),
            'updated_at' => $product->updated_at?->toIso8601String(),
            'images' => array_values($product->images->map(fn (ShopProductImage $image): array => [
                'id' => $image->id,
                'sort' => $image->sort,
                'alt' => $image->alt,
                'width' => $image->width,
                'height' => $image->height,
                'focal_x' => $image->focal_x,
                'focal_y' => $image->focal_y,
                'blurhash' => $image->blurhash,
                'url' => $images->variantUrl($image, 640),
                'original_width' => $image->original_width,
                'original_height' => $image->original_height,
            ])->all()),
            'missing' => app(ManageShopProducts::class)->missing($product),
        ];
    }

    /**
     * The exact member payloads (ShopProductCardResource, ShopProductResource), built even while the product is hidden.
     *
     * @return array{card: array<string, mixed>, detail: array<string, mixed>}
     */
    private static function preview(Request $request, ShopProduct $product): array
    {
        $view = app(ShopViews::class)->product($product);

        // Through the JSON response, so nested Resources are plain arrays exactly as the app receives them (Inertia would wrap each
        // nested Resource in its own `data`).
        $card = (new ShopProductCardResource($view))->response($request)->getData(true);
        $detail = (new ShopProductResource($view))->response($request)->getData(true);

        return ['card' => $card['data'], 'detail' => $detail['data']];
    }

    private function done(Request $request, ShopProduct $product, string $outcome): RedirectResponse|JsonResponse
    {
        if ($request->expectsJson() && ! $request->hasHeader('X-Inertia')) {
            return response()->json(['id' => $product->id, 'visible' => $product->visible, 'deleted' => $product->trashed()]);
        }

        return back(303)->with('success', "shop.flash.$outcome");
    }
}
