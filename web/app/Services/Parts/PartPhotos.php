<?php

namespace App\Services\Parts;

use App\Models\Brand;
use App\Models\Media;
use App\Models\Product;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\VisibleBuilds;
use App\Services\Garage\VehiclePresenter;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The photos of the photo-led catalogue (ADR-457, DQ-1138): no product has an image of its own, so every picture comes from a build
 * that carries the part.
 *
 * - thumbnails(): per product, the newest real build (not a sample) the viewer may see in a list, with a photo others may see; else
 *   none (the client shows the category glyph).
 * - lead(): the build photo of the most-used product (the first of the caller's ranking with a build): a real build, else, only
 *   while samples are shown (SampleContent), a sample, which the client badges "Beispiel".
 * - rail(): "Beliebt in Builds", up to 8 distinct builds, one per product in the caller's ranking, real builds before samples.
 * - brandRail(): up to 8 builds with a mod of the brand, real before samples, newest first, each with the brand's product it carries.
 *
 * Visibility is VisibleBuilds' (public, active verified owner, no block, samples only while shown); photos are the guest's view of the
 * cover (ready, not rejected), whoever reads, so a list never shows an owner's processing upload. ROW_NUMBER runs on MySQL 8 and
 * MariaDB 10.6+.
 */
final class PartPhotos
{
    public const RAIL = 8;

    public function __construct(
        private readonly VisibleBuilds $builds,
        private readonly VehiclePresenter $presenter,
    ) {}

    /**
     * @param  list<string>  $productIds
     * @return array<string, Media>
     */
    public function thumbnails(?User $viewer, array $productIds): array
    {
        $thumbnails = [];

        foreach ($this->photos($this->picks($viewer, $productIds, false)) as $pick) {
            $thumbnails[$pick['product_id']] = $pick['photo'];
        }

        return $thumbnails;
    }

    /**
     * @param  list<Product>  $ranked  most-used first
     * @return array{vehicle: Vehicle, photo: Media, product: Product|null}|null
     */
    public function lead(?User $viewer, array $ranked): ?array
    {
        $picks = $this->photos($this->picks($viewer, $this->ids($ranked), true));
        $byProduct = [];

        foreach ($picks as $pick) {
            $byProduct[$pick['product_id']] ??= $pick;
        }

        foreach ($ranked as $product) {
            if (isset($byProduct[$product->id])) {
                return ['vehicle' => $byProduct[$product->id]['vehicle'], 'photo' => $byProduct[$product->id]['photo'], 'product' => $product];
            }
        }

        return null;
    }

    /**
     * One build per product in rank order, real builds first (a pass over real builds, then one over samples while shown), never the
     * same build twice: each product offers its newest three builds, so two products on one build both find a card.
     *
     * @param  list<Product>  $ranked  most-used first
     * @return list<array{vehicle: Vehicle, photo: Media, product: Product|null}>
     */
    public function rail(?User $viewer, array $ranked): array
    {
        $candidates = [];

        foreach ($this->photos($this->picks($viewer, $this->ids($ranked), true, 3)) as $pick) {
            $candidates[$pick['product_id']][] = $pick;
        }

        $rail = [];
        $seen = [];
        $done = [];

        foreach ([0, 1] as $sample) {
            foreach ($ranked as $product) {
                if (isset($done[$product->id]) || count($rail) >= self::RAIL) {
                    continue;
                }

                foreach ($candidates[$product->id] ?? [] as $pick) {
                    if ($pick['sample'] === $sample && ! isset($seen[$pick['vehicle']->id])) {
                        $seen[$pick['vehicle']->id] = true;
                        $done[$product->id] = true;
                        $rail[] = ['vehicle' => $pick['vehicle'], 'photo' => $pick['photo'], 'product' => $product];

                        break;
                    }
                }
            }
        }

        return $rail;
    }

    /**
     * @return list<array{vehicle: Vehicle, photo: Media, product: Product|null}>
     */
    public function brandRail(?User $viewer, Brand $brand): array
    {
        $rows = VisibleBuilds::withPhoto($this->builds->query($viewer))
            ->whereExists(fn (Builder $mods) => $mods->selectRaw('1')->from('modifications as m')
                ->whereColumn('m.vehicle_id', 'vs.vehicle_id')->whereNull('m.deleted_at')->where('m.brand_id', $brand->id))
            ->select('vs.vehicle_id')
            ->selectRaw(VisibleBuilds::SAMPLE_RANK.' as sample')
            ->orderBy('sample')
            ->orderByDesc(VisibleBuilds::CHANGED_AT)
            ->orderByDesc('vs.vehicle_id')
            ->limit(self::RAIL)
            ->get();

        $ids = array_values(array_map(fn (object $row): string => (string) VisibleBuilds::column($row, 'vehicle_id'), $rows->all()));
        $vehicles = $this->builds->vehicles($ids);
        $products = $this->productsOn($ids, $brand);
        $rail = [];

        foreach ($ids as $id) {
            $vehicle = $vehicles[$id] ?? null;
            $photo = $vehicle instanceof Vehicle ? $this->presenter->cover($vehicle, false) : null;

            if ($vehicle instanceof Vehicle && $photo instanceof Media) {
                $rail[] = ['vehicle' => $vehicle, 'photo' => $photo, 'product' => $products[$id] ?? null];
            }
        }

        return $rail;
    }

    /**
     * The newest $depth builds per product, real builds first; $samples false keeps real builds only.
     *
     * @param  list<string>  $productIds
     * @return list<array{product_id: string, vehicle_id: string, sample: int}>
     */
    private function picks(?User $viewer, array $productIds, bool $samples, int $depth = 1): array
    {
        if ($productIds === []) {
            return [];
        }

        $ranked = VisibleBuilds::withPhoto($this->builds->query($viewer))
            ->join('modifications as m', 'm.vehicle_id', '=', 'vs.vehicle_id')
            ->whereNull('m.deleted_at')
            ->whereIn('m.product_id', $productIds)
            ->select('m.product_id', 'vs.vehicle_id')
            ->selectRaw(VisibleBuilds::SAMPLE_RANK.' as sample')
            ->selectRaw('ROW_NUMBER() OVER (PARTITION BY m.product_id ORDER BY '.VisibleBuilds::SAMPLE_RANK.', '.VisibleBuilds::CHANGED_AT.' DESC, vs.vehicle_id DESC) AS position');

        if (! $samples) {
            VisibleBuilds::realOnly($ranked);
        }

        $rows = DB::query()->fromSub($ranked, 'ranked')->where('position', '<=', $depth)->orderBy('product_id')->orderBy('position')->get();

        return array_values(array_map(fn (object $row): array => [
            'product_id' => (string) VisibleBuilds::column($row, 'product_id'),
            'vehicle_id' => (string) VisibleBuilds::column($row, 'vehicle_id'),
            'sample' => (int) VisibleBuilds::column($row, 'sample'),
        ], $rows->all()));
    }

    /**
     * The picks with their loaded vehicle and its cover (the guest's view); a pick whose photo went away in between drops out.
     *
     * @param  list<array{product_id: string, vehicle_id: string, sample: int}>  $picks
     * @return list<array{product_id: string, vehicle: Vehicle, photo: Media, sample: int}>
     */
    private function photos(array $picks): array
    {
        $vehicles = $this->builds->vehicles(array_values(array_unique(array_column($picks, 'vehicle_id'))));
        $out = [];

        foreach ($picks as $pick) {
            $vehicle = $vehicles[$pick['vehicle_id']] ?? null;
            $photo = $vehicle instanceof Vehicle ? $this->presenter->cover($vehicle, false) : null;

            if ($vehicle instanceof Vehicle && $photo instanceof Media) {
                $out[] = ['product_id' => $pick['product_id'], 'vehicle' => $vehicle, 'photo' => $photo, 'sample' => $pick['sample']];
            }
        }

        return $out;
    }

    /**
     * Per build, the first active product of $brand one of its mods links.
     *
     * @param  list<string>  $vehicleIds
     * @return array<string, Product>
     */
    private function productsOn(array $vehicleIds, Brand $brand): array
    {
        if ($vehicleIds === []) {
            return [];
        }

        $links = DB::table('modifications')->whereIn('vehicle_id', $vehicleIds)->whereNull('deleted_at')
            ->where('brand_id', $brand->id)->whereNotNull('product_id')->orderBy('sort')->orderBy('id')->get(['vehicle_id', 'product_id']);
        $products = Product::query()->active()->with('brand')->whereKey($links->pluck('product_id')->unique()->values()->all())->get()->keyBy('id');
        $out = [];

        foreach ($links as $link) {
            $product = $products->get((string) VisibleBuilds::column($link, 'product_id'));
            $vehicle = (string) VisibleBuilds::column($link, 'vehicle_id');

            if ($product instanceof Product && ! isset($out[$vehicle])) {
                $out[$vehicle] = $product;
            }
        }

        return $out;
    }

    /**
     * @param  list<Product>  $products
     * @return list<string>
     */
    private function ids(array $products): array
    {
        return array_map(fn (Product $product): string => $product->id, $products);
    }
}
