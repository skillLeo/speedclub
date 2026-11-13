<?php

namespace App\Http\Controllers\Admin\Parts;

use App\Actions\Admin\Parts\ManageProducts;
use App\Enums\ProductStatus;
use App\Http\Controllers\Admin\Parts\Requests\ProductRequest;
use App\Http\Controllers\Admin\Parts\Requests\ProductStateRequest;
use App\Http\Controllers\Admin\Support\ActivityFeed;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Brand;
use App\Models\ModCategory;
use App\Models\Product;
use App\Models\Staff;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-57 Teile & Produkte (09 §8.9, §10.3): the product table (filters q, brand, category, status; usage = mods linking it), the record,
 * create, edit, archive/restore and merge duplicates. The CSV import is ADM-17's with the kind `products` (dry-run diff first). Reads
 * need catalog.view, writes catalog.manage (route and FormRequest); merges also the recent password.
 */
class ProductsController extends Controller
{
    public const TABLE = 'catalog-products';

    public function index(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $base = Product::query()->with(['brand', 'category'])->withCount('modifications');

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('q', function (Builder $q, mixed $value): void {
                    $term = is_string($value) ? trim($value) : '';

                    if ($term !== '') {
                        $like = '%'.addcslashes($term, '%_\\').'%';
                        $q->where(fn (Builder $any) => $any->where('products.name', 'like', $like)->orWhere('products.line', 'like', $like)
                            ->orWhereHas('brand', fn (Builder $brand) => $brand->where('name', 'like', $like)));
                    }
                }),
                AllowedFilter::callback('brand', fn (Builder $q, mixed $value) => $q->where('products.brand_id', is_numeric($value) ? (int) $value : 0))->delimiter("\u{1}"),
                AllowedFilter::callback('category', fn (Builder $q, mixed $value) => $q->whereHas('category', fn (Builder $category) => $category->where('key', is_string($value) ? $value : '-')))->delimiter("\u{1}"),
                AllowedFilter::callback('status', fn (Builder $q, mixed $value) => $q->where('products.status', is_string($value) ? $value : '-'))->delimiter("\u{1}"),
            )
            ->allowedSorts('name', 'created_at', 'modifications_count')
            ->defaultSort('name');

        return Inertia::render('Catalog/Products', [
            ...TableProps::make($query, $request, self::TABLE, $staff, fn (array $products): array => array_map(self::row(...), $products), 'name'),
            'brands' => fn (): array => Brand::query()->whereNull('merged_into_id')->whereHas('products')->orderBy('name')->get(['id', 'name'])
                ->map(fn (Brand $brand): array => ['value' => $brand->id, 'label' => $brand->name])->all(),
            'categories' => fn (): array => self::categories(),
            'canManage' => $staff->can('catalog.manage'),
            'canImport' => $staff->can('catalog.import'),
            // M4.17: the brands a new part may name (every brand not merged), loaded when the drawer opens.
            'brandChoices' => Inertia::optional(fn (): array => self::brandChoices($staff)),
        ]);
    }

    public function show(Request $request, string $product): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $model = self::find($product);

        return Inertia::render('Catalog/ProductShow', [
            'product' => [
                ...self::row($model->loadCount('modifications')),
                'attributes' => $model->getAttribute('attributes') ?? (object) [],
                'url' => $model->url,
                'affiliate_url' => $model->affiliate_url,
                'aliases' => $model->aliases ?? [],
                'merged_into' => $model->merged_into_id,
                'merged_into_name' => $model->merged_into_id === null ? null : Product::query()->with('brand')->find($model->merged_into_id)?->fullName(),
            ],
            'activity' => fn (): array => ActivityFeed::for([$model->getMorphClass() => [$model->id]], $staff),
            'canManage' => $staff->can('catalog.manage'),
            'categories' => fn (): array => self::categories(),
            // M4.17: loaded when the edit drawer or the merge dialog opens (catalog.manage only).
            'brandChoices' => Inertia::optional(fn (): array => self::brandChoices($staff)),
            'mergeCandidates' => Inertia::optional(fn (): array => $staff->can('catalog.manage') ? self::candidates($model) : []),
        ]);
    }

    public function store(ProductRequest $request, ManageProducts $products): RedirectResponse|JsonResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $product = $products->add($staff, $request->productData(), $request->optionalReason());

        return $this->done($request, $product, 'created', 201);
    }

    public function update(ProductRequest $request, string $product, ManageProducts $products): RedirectResponse|JsonResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return $this->done($request, $products->change($staff, self::find($product), $request->productData(), $request->optionalReason()), 'updated');
    }

    public function archive(ProductStateRequest $request, string $product, ManageProducts $products): RedirectResponse|JsonResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return $this->done($request, $products->archive($staff, self::find($product), true, $request->reasonText()), 'archived');
    }

    public function restore(ProductStateRequest $request, string $product, ManageProducts $products): RedirectResponse|JsonResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return $this->done($request, $products->archive($staff, self::find($product), false, $request->reasonText()), 'restored');
    }

    public function merge(ProductStateRequest $request, string $product, ManageProducts $products): RedirectResponse|JsonResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return $this->done($request, $products->merge($staff, self::find($product), self::find((string) $request->validated('into')), $request->reasonText()), 'merged');
    }

    /**
     * @return array<string, mixed>
     */
    public static function row(Product $product): array
    {
        return [
            'id' => $product->id,
            'slug' => $product->slug,
            'name' => $product->name,
            'line' => $product->line,
            'brand' => ['id' => $product->brand_id, 'name' => $product->brand->name, 'slug' => $product->brand->slug],
            'category' => $product->category->key,
            'status' => $product->status->value,
            'merged' => $product->merged_into_id !== null,
            'mods' => (int) $product->getAttribute('modifications_count'),
            'has_affiliate' => $product->affiliate_url !== null,
            'created_at' => $product->created_at?->toIso8601String(),
        ];
    }

    /**
     * @return list<array{value: int, key: string, label: string}>
     */
    private static function categories(): array
    {
        $locale = app()->getLocale() === 'en' ? 'en' : 'de';

        return array_values(ModCategory::query()->orderBy('id')->get()
            ->map(fn (ModCategory $category): array => ['value' => $category->id, 'key' => $category->key, 'label' => (string) $category->getTranslation('name', $locale)])->all());
    }

    /**
     * @return list<array{value: int, label: string}>
     */
    private static function brandChoices(Staff $staff): array
    {
        if (! $staff->can('catalog.manage')) {
            return [];
        }

        return array_values(Brand::query()->whereNull('merged_into_id')->orderBy('name')->get(['id', 'name'])
            ->map(fn (Brand $brand): array => ['value' => $brand->id, 'label' => $brand->name])->all());
    }

    /**
     * Survivors a duplicate may be merged into: active parts of the same category, not merged themselves (09 §8.9).
     *
     * @return list<array{value: string, label: string, mods: int}>
     */
    private static function candidates(Product $product): array
    {
        return array_values(Product::query()->with('brand')->withCount('modifications')
            ->where('category_id', $product->category_id)->whereKeyNot($product->id)->whereNull('merged_into_id')
            ->where('status', ProductStatus::Active->value)
            ->orderByRaw('brand_id = ? desc', [$product->brand_id])->orderBy('name')->limit(300)->get()
            ->map(fn (Product $candidate): array => ['value' => $candidate->id, 'label' => $candidate->fullName(), 'mods' => (int) $candidate->getAttribute('modifications_count')])->all());
    }

    private static function find(string $id): Product
    {
        $product = preg_match('/\A[0-9A-Za-z]{26}\z/', $id) === 1 ? Product::query()->with(['brand', 'category'])->find(strtolower($id)) : null;
        abort_if($product === null, 404);

        return $product;
    }

    private function done(Request $request, Product $product, string $outcome, int $status = 200): RedirectResponse|JsonResponse
    {
        if ($request->expectsJson() && ! $request->hasHeader('X-Inertia')) {
            return response()->json(['id' => $product->id, 'status' => $product->status === ProductStatus::Active ? 'active' : 'archived'], $status);
        }

        return back(303)->with('success', "catalog.products.flash.$outcome");
    }
}
