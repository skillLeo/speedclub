<?php

namespace App\Services\Parts;

use App\Models\Brand;
use App\Models\Product;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\VisibleBuilds;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Query\Builder;

/**
 * "Builds mit {Produkt}" and "Builds mit {Marke}" (09 §7.11 BRD-01/02, VEH-02 rail, DQ-1070) and their real counts ("In 14 Builds"):
 * the builds VisibleBuilds lists for the viewer (public, active verified owner, no block, samples only while shown) with a mod (not
 * deleted) that links the product, or is of the brand. Counts are of real builds only, never of mods and never of samples (DQ-1140,
 * ADR-457); walls list real builds first and badged samples after them.
 */
final class PartBuilds
{
    public function __construct(private readonly VisibleBuilds $builds) {}

    /**
     * @return CursorPaginator<int, Vehicle>
     */
    public function forProduct(?User $viewer, Product $product, int $perPage): CursorPaginator
    {
        return $this->page($this->withMod($this->builds->query($viewer), 'product_id', [$product->id]), $perPage);
    }

    /**
     * @return CursorPaginator<int, Vehicle>
     */
    public function forBrand(?User $viewer, Brand $brand, int $perPage): CursorPaginator
    {
        return $this->page($this->withMod($this->builds->query($viewer), 'brand_id', [$brand->id]), $perPage);
    }

    /**
     * $products (filters applied, nothing selected or ordered yet) as a derived table with `real_builds` (the visible real builds per
     * product, as productCounts() counts them) and `visible_builds` (samples included while shown), ordered by real builds, then
     * visible builds (a sample only breaks ties, so it never lifts a product above one with a real build), name and id; the cursor
     * reads all four from the rows (ADR-457: lists sort by real build count).
     *
     * @param  EloquentBuilder<Product>  $products
     * @return EloquentBuilder<Product>
     */
    public function ranked(EloquentBuilder $products, ?User $viewer): EloquentBuilder
    {
        $inner = $products->select('products.*')
            ->selectSub(VisibleBuilds::realOnly($this->productBuilds($viewer)), 'real_builds')
            ->selectSub($this->productBuilds($viewer), 'visible_builds');

        return Product::query()->fromSub($inner->toBase(), 'products')
            ->orderByDesc('products.real_builds')->orderByDesc('products.visible_builds')->orderBy('products.name')->orderBy('products.id');
    }

    /**
     * The count of visible builds with a mod linking the outer query's `products.id` (a correlated subquery).
     */
    private function productBuilds(?User $viewer): Builder
    {
        return $this->builds->query($viewer)
            ->join('modifications as m', 'm.vehicle_id', '=', 'vs.vehicle_id')
            ->whereNull('m.deleted_at')
            ->whereColumn('m.product_id', 'products.id')
            ->selectRaw('count(distinct vs.vehicle_id)');
    }

    /**
     * Visible real builds per product.
     *
     * @param  list<string>  $ids
     * @return array<string, int>
     */
    public function productCounts(?User $viewer, array $ids): array
    {
        return $this->counts($viewer, 'product_id', $ids);
    }

    /**
     * Visible real builds per brand.
     *
     * @param  list<int>  $ids
     * @return array<int, int>
     */
    public function brandCounts(?User $viewer, array $ids): array
    {
        return $this->counts($viewer, 'brand_id', $ids);
    }

    /**
     * "Marken im Fokus": brands of the parts catalogue (with an active product) by their number of visible real builds, most first; a
     * brand without any visible build is left out (never an empty tile). `builds` is the real count (0 when only samples carry the
     * brand: the client hides the number); samples only break ties, so a sample never lifts a brand above a real one.
     *
     * @return list<array{brand: Brand, builds: int}>
     */
    public function topBrands(?User $viewer, int $limit): array
    {
        $rows = $this->builds->query($viewer)
            ->join('modifications as m', 'm.vehicle_id', '=', 'vs.vehicle_id')
            ->whereNull('m.deleted_at')
            ->whereNotNull('m.brand_id')
            ->whereExists(fn (Builder $products) => $products->selectRaw('1')->from('products as p')->whereColumn('p.brand_id', 'm.brand_id')->where('p.status', 'active'))
            ->groupBy('m.brand_id')
            ->selectRaw('m.brand_id as brand_id, count(distinct case when '.VisibleBuilds::SAMPLE_RANK.' = 0 then vs.vehicle_id end) as builds, count(distinct vs.vehicle_id) as visible')
            ->orderByDesc('builds')
            ->orderByDesc('visible')
            ->orderBy('m.brand_id')
            ->limit($limit)
            ->get();

        $brands = Brand::query()->whereKey($rows->pluck('brand_id')->all())->get()->keyBy('id');
        $top = [];

        foreach ($rows as $row) {
            $brand = $brands->get((int) VisibleBuilds::column($row, 'brand_id'));

            if ($brand instanceof Brand) {
                $top[] = ['brand' => $brand, 'builds' => (int) VisibleBuilds::column($row, 'builds')];
            }
        }

        return $top;
    }

    /**
     * @param  'product_id'|'brand_id'  $column
     * @param  list<int|string>  $ids
     * @return array<array-key, int>
     */
    private function counts(?User $viewer, string $column, array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $rows = VisibleBuilds::realOnly($this->builds->query($viewer))
            ->join('modifications as m', 'm.vehicle_id', '=', 'vs.vehicle_id')
            ->whereNull('m.deleted_at')
            ->whereIn("m.$column", $ids)
            ->groupBy("m.$column")
            ->selectRaw("m.$column as item, count(distinct vs.vehicle_id) as builds")
            ->get();

        $counts = array_fill_keys($ids, 0);

        foreach ($rows as $row) {
            $counts[VisibleBuilds::column($row, 'item')] = (int) VisibleBuilds::column($row, 'builds');
        }

        return $counts;
    }

    /**
     * @param  list<int|string>  $ids
     */
    private function withMod(Builder $query, string $column, array $ids): Builder
    {
        return $query->whereExists(fn (Builder $mods) => $mods->selectRaw('1')->from('modifications as m')
            ->whereColumn('m.vehicle_id', 'vs.vehicle_id')->whereNull('m.deleted_at')->whereIn("m.$column", $ids));
    }

    /**
     * Real builds first, then samples (ADR-457), each last changed first.
     *
     * @return CursorPaginator<int, Vehicle>
     */
    private function page(Builder $hits, int $perPage): CursorPaginator
    {
        return $this->builds->paginate(self::realFirst($hits), ['sample' => 'asc', 'sort_at' => 'desc', 'id' => 'desc'], $perPage);
    }

    /**
     * Selects `id`, `sample` (VisibleBuilds::SAMPLE_RANK) and `sort_at` for VisibleBuilds::paginate() with the order sample asc,
     * sort_at desc, id desc.
     */
    public static function realFirst(Builder $hits): Builder
    {
        return $hits->select('vs.vehicle_id as id', VisibleBuilds::CHANGED_AT.' as sort_at')->selectRaw(VisibleBuilds::SAMPLE_RANK.' as sample');
    }
}
