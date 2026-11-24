<?php

namespace App\Services\Parts;

use App\Models\Brand;
use App\Models\Product;
use App\Models\User;
use App\Services\Catalog\CatalogSlugs;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;

/**
 * Active products (not archived, not merged away) by name, with the filters of ProductSearchRequest. LIKE only (MySQL 8 and MariaDB
 * alike): the term matches the name, the line, an alias or the brand's name or aliases; a term of several words (M5.9, "kw v3") matches
 * when every word does. By name, then id (the cursor); $ranked (the Teile
 * scope, `counts=true`) by the real build count first (ADR-457).
 */
final class ProductSearch
{
    /**
     * @param  array{q: string|null, brand: string|null, category: string|null}  $filters
     * @return CursorPaginator<int, Product>
     */
    public function page(array $filters, int $perPage, bool $ranked = false, ?User $viewer = null): CursorPaginator
    {
        $query = Product::query()->active();

        if ($filters['brand'] !== null) {
            $brand = CatalogSlugs::brand($filters['brand']);
            $query->where('products.brand_id', $brand instanceof Brand ? $brand->id : 0);
        }

        if ($filters['category'] !== null) {
            $query->whereHas('category', fn (Builder $category) => $category->where('key', $filters['category']));
        }

        if ($filters['q'] !== null) {
            $this->matchText($query, $filters['q']);
        }

        if ($ranked) {
            return app(PartBuilds::class)->ranked($query, $viewer)->with(['brand', 'category'])->cursorPaginate($perPage)->withQueryString();
        }

        return $query->with(['brand', 'category'])->orderBy('products.name')->orderBy('products.id')->cursorPaginate($perPage)->withQueryString();
    }

    /**
     * M5.9 (m5.9-contract §2.2): active products whose name, line, aliases or brand match every word of $words (the mod editor's catalogue
     * match, and the AI's normalised words, MatchProduct). At most $limit, by name.
     *
     * @param  list<string>  $words
     * @return Collection<int, Product>
     */
    public function matchWords(array $words, ?string $category, int $limit): Collection
    {
        $words = self::words(implode(' ', $words));

        if ($words === []) {
            return new Collection;
        }

        $query = Product::query()->active();

        if ($category !== null) {
            $query->whereHas('category', fn (Builder $type) => $type->where('key', $category));
        }

        foreach ($words as $word) {
            $this->matchOne($query, $word);
        }

        return $query->with(['brand', 'category'])->orderBy('products.name')->orderBy('products.id')->limit($limit)->get();
    }

    /**
     * The words of a search text: split on spaces, at most 6, empty ones dropped.
     *
     * @return list<string>
     */
    public static function words(string $text): array
    {
        return array_slice(array_values(array_filter(preg_split('/\s+/u', trim($text)) ?: [], fn (string $word): bool => $word !== '')), 0, 6);
    }

    /**
     * One word: the whole text as before; several (M5.9, "kw v3"): each word must match name, line, aliases or the brand.
     *
     * @param  Builder<Product>  $query
     */
    private function matchText(Builder $query, string $text): void
    {
        $words = self::words($text);

        if (count($words) < 2) {
            $this->matchOne($query, $text);

            return;
        }

        foreach ($words as $word) {
            $this->matchOne($query, $word);
        }
    }

    /**
     * @param  Builder<Product>  $query
     */
    private function matchOne(Builder $query, string $term): void
    {
        $like = '%'.addcslashes($term, '%_\\').'%';
        $query->where(fn (Builder $any) => $any->where('products.name', 'like', $like)
            ->orWhere('products.line', 'like', $like)
            ->orWhere('products.aliases', 'like', $like)
            ->orWhereHas('brand', fn (Builder $brand) => $brand->where('name', 'like', $like)->orWhere('aliases', 'like', $like)));
    }
}
