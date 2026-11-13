<?php

namespace App\Services\Parts;

use App\Models\Brand;
use App\Models\Product;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\VisibleBuilds;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Query\Builder;

/**
 * "Builds mit {Produkt}" and "Builds mit {Marke}" (09 §7.11 BRD-01/02, VEH-02 rail, DQ-1070) and their real counts ("In 14 Builds"):
 * the builds VisibleBuilds lists for the viewer (public, active verified owner, no block, samples only while shown) with a mod (not
 * deleted) that links the product, or is of the brand. Counts are of builds, never of mods, and never invented.
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
     * Visible builds per product.
     *
     * @param  list<string>  $ids
     * @return array<string, int>
     */
    public function productCounts(?User $viewer, array $ids): array
    {
        return $this->counts($viewer, 'product_id', $ids);
    }

    /**
     * Visible builds per brand.
     *
     * @param  list<int>  $ids
     * @return array<int, int>
     */
    public function brandCounts(?User $viewer, array $ids): array
    {
        return $this->counts($viewer, 'brand_id', $ids);
    }

    /**
     * "Marken im Fokus": brands of the parts catalogue (with an active product) by their number of visible builds, most first; a brand
     * without a build is left out (never an empty tile).
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
            ->selectRaw('m.brand_id as brand_id, count(distinct vs.vehicle_id) as builds')
            ->orderByDesc('builds')
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

        $rows = $this->builds->query($viewer)
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
     * @return CursorPaginator<int, Vehicle>
     */
    private function page(Builder $hits, int $perPage): CursorPaginator
    {
        return $this->builds->paginate($hits->select('vs.vehicle_id as id', VisibleBuilds::CHANGED_AT.' as sort_at'), ['sort_at' => 'desc', 'id' => 'desc'], $perPage);
    }
}
