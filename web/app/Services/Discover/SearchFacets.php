<?php

namespace App\Services\Discover;

use App\Enums\Drivetrain;
use App\Enums\Fuel;
use App\Enums\Gearbox;
use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\ModCategory;
use App\Models\User;
use App\Models\VehicleModel;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The counts of the DISC-02 filter sheet (m2.3 contract §2). Disjunctive: each group is counted with every other active filter and the
 * text applied, but not its own (nor, in the catalogue, what hangs below it: makes are counted without model and generation), so the
 * sheet shows "BMW (12)" next to an active "Audi". Visibility is that of the results (VisibleBuilds, blocks included). A value with
 * count 0 is left out unless it is active; then it comes with 0, so the sheet can still show and remove it.
 *
 * One query per group over the projection and its facet rows; nothing reads JSON. The total stops at speedclub.search.count_cap.
 */
final class SearchFacets
{
    public function __construct(private readonly TextSearch $search) {}

    /**
     * @param  list<string>|null  $words
     */
    public function for(?User $viewer, ?array $words, SearchFilters $filters): FacetSet
    {
        $locale = app()->getLocale();
        $base = fn (?string $except): Builder => $this->search->matching($viewer, $words, $filters, $except);
        $total = $this->search->countVehicles($viewer, $words, $filters);

        return new FacetSet(
            total: $total->count,
            totalCapped: $total->capped,
            makes: $this->makes($base('make'), $filters),
            models: $filters->make === null ? null : $this->models($base('model'), $filters),
            generations: $filters->model === null ? null : $this->generations($base('generation'), $filters),
            drivetrain: $this->enumFacet($base('drivetrain'), 'drivetrain', Drivetrain::cases(), $filters->drivetrain, $locale),
            gearbox: $this->enumFacet($base('gearbox'), 'gearbox', Gearbox::cases(), $filters->gearbox, $locale),
            fuel: $this->enumFacet($base('fuel'), 'fuel', Fuel::cases(), $filters->fuel, $locale),
            wheelDiameter: $this->diameters($base('wheel_diameter'), $filters->wheelDiameters, $locale),
            wheelBrand: $this->brands($base('wheel_brand'), 'wheel_brand', $filters->wheelBrands),
            suspensionType: $this->suspensionTypes($base('suspension_type'), $filters->suspensionTypes, $locale),
            suspensionBrand: $this->brands($base('suspension_brand'), 'suspension_brand', $filters->suspensionBrands),
            exhaustBrand: $this->brands($base('exhaust_brand'), 'exhaust_brand', $filters->exhaustBrands),
            modCategory: $this->categories($base('mod_category'), $filters->modCategories, $locale),
            year: $this->range($base('year'), 'year'),
            power: $this->range($base('power'), 'power'),
        );
    }

    /**
     * Most builds first, then by name.
     *
     * @return list<Facet>
     */
    private function makes(Builder $query, SearchFilters $filters): array
    {
        $rows = $query->join('makes as m', 'm.id', '=', 'vs.make_id')
            ->groupBy('m.id', 'm.slug', 'm.name')
            ->select('m.slug as value', 'm.name as label')
            ->selectRaw('COUNT(*) as hits')
            ->orderByDesc('hits')->orderBy('m.name')->orderBy('m.id')
            ->get();

        return $this->withActive($this->facets($rows), $filters->make === null ? [] : [$this->catalogFacet($filters->make)]);
    }

    /**
     * Models of the active make, most builds first, then by name.
     *
     * @return list<Facet>
     */
    private function models(Builder $query, SearchFilters $filters): array
    {
        $rows = $query->join('vehicle_models as vm', 'vm.id', '=', 'vs.model_id')
            ->groupBy('vm.id', 'vm.slug', 'vm.name')
            ->select('vm.slug as value', 'vm.name as label')
            ->selectRaw('COUNT(*) as hits')
            ->orderByDesc('hits')->orderBy('vm.name')->orderBy('vm.id')
            ->get();

        return $this->withActive($this->facets($rows), $filters->model === null ? [] : [$this->catalogFacet($filters->model)]);
    }

    /**
     * Generations of the active model, oldest first, as the generation chips of DISC-04 read.
     *
     * @return list<Facet>
     */
    private function generations(Builder $query, SearchFilters $filters): array
    {
        $rows = $query->join('generations as g', 'g.id', '=', 'vs.generation_id')
            ->groupBy('g.id', 'g.slug', 'g.name', 'g.year_from')
            ->select('g.slug as value', 'g.name as label')
            ->selectRaw('COUNT(*) as hits')
            ->orderByRaw('g.year_from IS NULL, g.year_from')->orderBy('g.name')->orderBy('g.id')
            ->get();

        return $this->withActive($this->facets($rows), $filters->generation === null ? [] : [$this->catalogFacet($filters->generation)]);
    }

    /**
     * In the enum's order.
     *
     * @param  array<int, Drivetrain|Gearbox|Fuel>  $cases
     * @param  list<string>  $active
     * @return list<Facet>
     */
    private function enumFacet(Builder $query, string $column, array $cases, array $active, string $locale): array
    {
        $counts = $query->whereNotNull('vs.'.$column)
            ->groupBy('vs.'.$column)
            ->select('vs.'.$column.' as value')
            ->selectRaw('COUNT(*) as hits')
            ->pluck('hits', 'value');

        $facets = [];

        foreach ($cases as $case) {
            $count = (int) ($counts[$case->value] ?? 0);

            if ($count > 0 || in_array($case->value, $active, true)) {
                $facets[] = new Facet((string) $case->value, $case->label($locale), $count);
            }
        }

        return $facets;
    }

    /**
     * Ascending; label "19″" / "19,5″" (DE) or "19.5″" (EN).
     *
     * @param  list<string>  $active
     * @return list<Facet>
     */
    private function diameters(Builder $query, array $active, string $locale): array
    {
        $counts = $this->rowCounts($query, 'wheel_diameter');

        foreach ($active as $value) {
            $counts[$value] ??= 0;
        }

        uksort($counts, fn (int|string $a, int|string $b): int => (float) $a <=> (float) $b);
        $facets = [];

        foreach ($counts as $value => $count) {
            $number = $locale === 'de' ? str_replace('.', ',', (string) $value) : (string) $value;
            $facets[] = new Facet((string) $value, $number.'″', $count);
        }

        return $facets;
    }

    /**
     * The 20 brands with the most builds (then by name), plus active ones further down.
     *
     * @param  array<string, int>  $active  slug => id
     * @return list<Facet>
     */
    private function brands(Builder $query, string $facet, array $active): array
    {
        $counts = $this->rowCounts($query, $facet);
        $ids = array_unique([...array_map(intval(...), array_keys($counts)), ...array_values($active)]);
        $brands = Brand::query()->whereKey($ids)->get(['id', 'slug', 'name'])->keyBy('id');
        $facets = [];

        foreach ($counts as $id => $count) {
            $brand = $brands->get((int) $id);

            if ($brand instanceof Brand) {
                $facets[] = new Facet((string) $brand->getAttribute('slug'), (string) $brand->getAttribute('name'), $count);
            }
        }

        usort($facets, fn (Facet $a, Facet $b): int => [$b->count, mb_strtolower($a->label)] <=> [$a->count, mb_strtolower($b->label)]);
        $top = array_slice($facets, 0, config()->integer('speedclub.search.facet_brands'));
        $extra = [];
        $listed = [];

        foreach ($active as $slug => $id) {
            $brand = $brands->get($id);

            // A merged brand's slug stands for the brand it was merged into (M2.3 review #16): one row, under the slug the request used, so
            // the sheet finds its active value; a second slug of the same brand adds nothing.
            if (! $brand instanceof Brand || isset($listed[$id])) {
                continue;
            }

            $listed[$id] = true;
            $canonical = (string) $brand->getAttribute('slug');
            $slug = array_key_exists($canonical, $active) ? $canonical : $slug;
            $position = array_search($canonical, array_map(fn (Facet $facet): string => $facet->value, $top), true);

            if ($position !== false) {
                $top[$position] = new Facet($slug, $top[$position]->label, $top[$position]->count);
            } else {
                $extra[] = new Facet($slug, (string) $brand->getAttribute('name'), $counts[$id] ?? 0);
            }
        }

        return $this->withActive(array_values($top), $extra);
    }

    /**
     * In the order of the field's options (ADM-15).
     *
     * @param  list<string>  $active
     * @return list<Facet>
     */
    private function suspensionTypes(Builder $query, array $active, string $locale): array
    {
        $counts = $this->rowCounts($query, 'suspension_type');
        $facets = [];

        foreach (SearchFilterResolver::suspensionTypeOptions() as $option) {
            $count = $counts[$option['value']] ?? 0;

            if ($count > 0 || in_array($option['value'], $active, true)) {
                $facets[] = new Facet($option['value'], $option['label'][$locale] ?? $option['label']['de'] ?? $option['value'], $count);
            }
        }

        return $facets;
    }

    /**
     * One query: builds per distinct mod_category_mask, summed per category bit here, in the categories' order. A build counts once per
     * category it has an installed mod in.
     *
     * @param  array<string, int>  $active
     * @return list<Facet>
     */
    private function categories(Builder $query, array $active, string $locale): array
    {
        $categories = ModCategory::query()->where('active', true)->orderBy('sort')->get();
        $bits = SearchFilterResolver::categoryBits();
        $masks = $query->groupBy('vs.mod_category_mask')->select('vs.mod_category_mask as mask')->selectRaw('COUNT(*) as hits')->get();
        $byKey = array_fill_keys(array_keys($bits), 0);

        foreach ($masks as $row) {
            $mask = (int) VisibleBuilds::column($row, 'mask');
            $hits = (int) VisibleBuilds::column($row, 'hits');

            foreach ($bits as $key => $bit) {
                if (($mask & $bit) !== 0) {
                    $byKey[$key] += $hits;
                }
            }
        }

        $facets = [];

        foreach ($categories as $category) {
            $count = $byKey[$category->key] ?? null;

            if ($count !== null && ($count > 0 || isset($active[$category->key]))) {
                $facets[] = new Facet($category->key, (string) $category->getTranslation('name', $locale), $count);
            }
        }

        return $facets;
    }

    /**
     * @param  'year'|'power'  $kind
     * @return array{min: int, max: int}|null null when no build has the value
     */
    private function range(Builder $query, string $kind): ?array
    {
        $row = $kind === 'year'
            ? $query->whereNotNull('vs.model_year')->selectRaw('MIN(vs.model_year) as low, MAX(vs.model_year) as high')->first()
            : $query->whereNotNull('vs.power_ps')->selectRaw('MIN(vs.power_ps) as low, MAX(vs.power_ps) as high')->first();
        $low = $row === null ? null : VisibleBuilds::column($row, 'low');
        $high = $row === null ? null : VisibleBuilds::column($row, 'high');

        return is_numeric($low) && is_numeric($high) ? ['min' => (int) floor((float) $low), 'max' => (int) ceil((float) $high)] : null;
    }

    /**
     * Builds per value of one facet row kind. Each (build, facet, value) exists once, so COUNT(*) counts builds.
     *
     * @return array<int|string, int>
     */
    private function rowCounts(Builder $query, string $facet): array
    {
        // The filtered builds as a set, then the rows of this facet in it: one pass over each, whatever plan the optimizer picks. A join
        // from the builds let stale statistics read every row of the facet once per build.
        $counts = DB::table('vehicle_search_facets', 'fr')
            ->where('fr.facet', $facet)
            ->whereIn('fr.vehicle_id', $query->select('vs.vehicle_id'))
            ->groupBy('fr.value')
            ->select('fr.value')
            ->selectRaw('COUNT(*) as hits')
            ->pluck('hits', 'value');

        $result = [];

        foreach ($counts as $value => $hits) {
            $result[$value] = (int) $hits;
        }

        return $result;
    }

    /**
     * @param  iterable<object>  $rows  value, label, hits
     * @return list<Facet>
     */
    private function facets(iterable $rows): array
    {
        $facets = [];

        foreach ($rows as $row) {
            $facets[] = new Facet((string) VisibleBuilds::column($row, 'value'), (string) VisibleBuilds::column($row, 'label'), (int) VisibleBuilds::column($row, 'hits'));
        }

        return $facets;
    }

    private function catalogFacet(Make|VehicleModel|Generation $row): Facet
    {
        return new Facet((string) $row->getAttribute('slug'), (string) $row->getAttribute('name'), 0);
    }

    /**
     * Active values the counts left out, appended with their own count.
     *
     * @param  list<Facet>  $facets
     * @param  list<Facet>  $active
     * @return list<Facet>
     */
    private function withActive(array $facets, array $active): array
    {
        $values = array_map(fn (Facet $facet): string => $facet->value, $facets);

        foreach ($active as $facet) {
            if (! in_array($facet->value, $values, true)) {
                $facets[] = $facet;
            }
        }

        return $facets;
    }
}
