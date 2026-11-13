<?php

namespace App\Services\Parts;

use App\Models\Brand;
use App\Models\Product;
use App\Models\User;
use App\Services\Catalog\CatalogSlugs;
use Illuminate\Contracts\Pagination\CursorPaginator;

/**
 * BRD-01 and WEB-11 data (09 §7.11, §9): a part brand has a page when the catalogue holds an active product of it or a visible build
 * names it, so no empty page is ever linked. Counts are real.
 */
final class BrandPages
{
    public function __construct(private readonly PartBuilds $builds) {}

    /**
     * The brand behind $slug (a merged brand's old slug answers its survivor), or null when it has no page.
     */
    public function find(string $slug): ?Brand
    {
        if (preg_match('/\A[a-z0-9-]{1,140}\z/', $slug) !== 1) {
            return null;
        }

        $brand = CatalogSlugs::brand($slug);

        if (! $brand instanceof Brand) {
            return null;
        }

        $hasProducts = Product::query()->active()->where('brand_id', $brand->id)->exists();

        return $hasProducts || $brand->modifications()->exists() ? $brand : null;
    }

    /**
     * @return array{brand: Brand, builds: int, products: int, lines: list<array{name: string, products: int}>}
     */
    public function page(?User $viewer, Brand $brand): array
    {
        $lines = array_values(Product::query()->active()->where('brand_id', $brand->id)->whereNotNull('line')
            ->groupBy('line')->selectRaw('line, count(*) as products')->orderBy('line')->get()
            ->map(fn (Product $row): array => ['name' => (string) $row->getAttribute('line'), 'products' => (int) $row->getAttribute('products')])
            ->values()->all());

        return [
            'brand' => $brand,
            'builds' => $this->builds->brandCounts($viewer, [$brand->id])[$brand->id] ?? 0,
            'products' => Product::query()->active()->where('brand_id', $brand->id)->count(),
            'lines' => $lines,
        ];
    }

    /**
     * @return CursorPaginator<int, Product>
     */
    public function products(Brand $brand, int $perPage): CursorPaginator
    {
        return Product::query()->active()->with(['brand', 'category'])->where('brand_id', $brand->id)
            ->orderBy('products.name')->orderBy('products.id')->cursorPaginate($perPage)->withQueryString();
    }
}
