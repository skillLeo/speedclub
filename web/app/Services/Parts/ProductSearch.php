<?php

namespace App\Services\Parts;

use App\Models\Brand;
use App\Models\Product;
use App\Services\Catalog\CatalogSlugs;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Builder;

/**
 * Active products (not archived, not merged away) by name, with the filters of ProductSearchRequest. LIKE only (MySQL 8 and MariaDB
 * alike): the term matches the name, the line, an alias or the brand's name or aliases. By name, then id (the cursor).
 */
final class ProductSearch
{
    /**
     * @param  array{q: string|null, brand: string|null, category: string|null}  $filters
     * @return CursorPaginator<int, Product>
     */
    public function page(array $filters, int $perPage): CursorPaginator
    {
        $query = Product::query()->active()->with(['brand', 'category']);

        if ($filters['brand'] !== null) {
            $brand = CatalogSlugs::brand($filters['brand']);
            $query->where('products.brand_id', $brand instanceof Brand ? $brand->id : 0);
        }

        if ($filters['category'] !== null) {
            $query->whereHas('category', fn (Builder $category) => $category->where('key', $filters['category']));
        }

        if ($filters['q'] !== null) {
            $like = '%'.addcslashes($filters['q'], '%_\\').'%';
            $query->where(fn (Builder $any) => $any->where('products.name', 'like', $like)
                ->orWhere('products.line', 'like', $like)
                ->orWhere('products.aliases', 'like', $like)
                ->orWhereHas('brand', fn (Builder $brand) => $brand->where('name', 'like', $like)->orWhere('aliases', 'like', $like)));
        }

        return $query->orderBy('products.name')->orderBy('products.id')->cursorPaginate($perPage)->withQueryString();
    }
}
