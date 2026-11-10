<?php

namespace App\Services\Discover;

use App\Models\Generation;
use App\Models\Make;
use App\Models\VehicleModel;
use Illuminate\Database\Query\Builder;

/**
 * The DISC-02 filters of 02_PRODUCT_SPEC §3.7, resolved against the catalogue (SearchFilterResolver). Every filter reads the
 * vehicle_search projection or its facet rows (vehicle_search_facets), never a JSON field at request time.
 *
 * Semantics: different filters all apply (AND); the values of one list are alternatives (OR: wheel_diameter[]=19&wheel_diameter[]=20
 * is "19 or 20 inch"); a range is inclusive. A list value matches any installed part of its category, not just the first: a build with
 * a 19-inch front and a 20-inch rear is found by both.
 *
 * Facet groups for apply()'s $except: make, model, generation, year, power, drivetrain, gearbox, fuel, wheel_diameter, wheel_brand,
 * suspension_type, suspension_brand, exhaust_brand, mod_category. The catalogue is a hierarchy: leaving out make also leaves out model
 * and generation, leaving out model also leaves out generation (a make facet next to an active M4 still lists Audi).
 */
final readonly class SearchFilters
{
    /** Facet rows of vehicle_search_facets, by request parameter. */
    public const FACET_ROWS = ['wheel_diameter', 'wheel_brand', 'suspension_type', 'suspension_brand', 'exhaust_brand'];

    /**
     * @param  list<string>  $drivetrain
     * @param  list<string>  $gearbox
     * @param  list<string>  $fuel
     * @param  list<string>  $wheelDiameters  canonical ("19", "19.5"), ascending
     * @param  array<string, int>  $wheelBrands  slug => brand id (after merges)
     * @param  list<string>  $suspensionTypes
     * @param  array<string, int>  $suspensionBrands
     * @param  array<string, int>  $exhaustBrands
     * @param  array<string, int>  $modCategories  key => bit of mod_category_mask
     */
    public function __construct(
        public ?Make $make = null,
        public ?VehicleModel $model = null,
        public ?Generation $generation = null,
        public ?int $yearMin = null,
        public ?int $yearMax = null,
        public ?int $powerMin = null,
        public ?int $powerMax = null,
        public array $drivetrain = [],
        public array $gearbox = [],
        public array $fuel = [],
        public array $wheelDiameters = [],
        public array $wheelBrands = [],
        public array $suspensionTypes = [],
        public array $suspensionBrands = [],
        public array $exhaustBrands = [],
        public array $modCategories = [],
    ) {}

    public function isEmpty(): bool
    {
        return $this->params() === [];
    }

    /**
     * The filters as the query parameters of search/vehicles, set ones only, in the order of the filter sheet. A model always comes
     * with its make and a generation with its model, so the result reads back to the same filters.
     *
     * @return array<string, string|int|list<string>|list<float>>
     */
    public function params(): array
    {
        $params = [];

        if ($this->make !== null) {
            $params['make'] = (string) $this->make->getAttribute('slug');
        }

        if ($this->model !== null) {
            $params['model'] = (string) $this->model->getAttribute('slug');
        }

        if ($this->generation !== null) {
            $params['generation'] = (string) $this->generation->getAttribute('slug');
        }

        foreach (['year_min' => $this->yearMin, 'year_max' => $this->yearMax, 'power_min' => $this->powerMin, 'power_max' => $this->powerMax] as $key => $value) {
            if ($value !== null) {
                $params[$key] = $value;
            }
        }

        $lists = [
            'drivetrain' => $this->drivetrain,
            'gearbox' => $this->gearbox,
            'fuel' => $this->fuel,
            'wheel_diameter' => array_map(floatval(...), $this->wheelDiameters),
            'wheel_brand' => array_keys($this->wheelBrands),
            'suspension_type' => $this->suspensionTypes,
            'suspension_brand' => array_keys($this->suspensionBrands),
            'exhaust_brand' => array_keys($this->exhaustBrands),
            'mod_category' => array_keys($this->modCategories),
        ];

        foreach ($lists as $key => $values) {
            if ($values !== []) {
                $params[$key] = $values;
            }
        }

        return $params;
    }

    /**
     * What the filters mean, independent of slugs and value order: part of a cursor's signature (SearchCursor).
     *
     * @return array<string, mixed>
     */
    public function canonical(): array
    {
        $sorted = function (array $values): array {
            sort($values);

            return $values;
        };

        return array_filter([
            'make' => $this->make?->getKey(),
            'model' => $this->model?->getKey(),
            'generation' => $this->generation?->getKey(),
            'year' => [$this->yearMin, $this->yearMax],
            'power' => [$this->powerMin, $this->powerMax],
            'drivetrain' => $sorted($this->drivetrain),
            'gearbox' => $sorted($this->gearbox),
            'fuel' => $sorted($this->fuel),
            'wheel_diameter' => $sorted($this->wheelDiameters),
            'wheel_brand' => $sorted(array_values($this->wheelBrands)),
            'suspension_type' => $sorted($this->suspensionTypes),
            'suspension_brand' => $sorted(array_values($this->suspensionBrands)),
            'exhaust_brand' => $sorted(array_values($this->exhaustBrands)),
            'mod_category' => $sorted(array_values($this->modCategories)),
        ], fn (mixed $value): bool => $value !== null && $value !== [] && $value !== [null, null]);
    }

    /**
     * Narrows a query over vehicle_search as vs (VisibleBuilds) to the filters, leaving out the facet group $except (and what depends on
     * it in the catalogue).
     */
    public function apply(Builder $query, ?string $except = null): Builder
    {
        $skipMake = $except === 'make';
        $skipModel = $skipMake || $except === 'model';
        $skipGeneration = $skipModel || $except === 'generation';

        if ($this->make !== null && ! $skipMake) {
            $query->where('vs.make_id', $this->make->getKey());
        }

        if ($this->model !== null && ! $skipModel) {
            $query->where('vs.model_id', $this->model->getKey());
        }

        if ($this->generation !== null && ! $skipGeneration) {
            $query->where('vs.generation_id', $this->generation->getKey());
        }

        if ($except !== 'year') {
            $this->range($query, 'vs.model_year', $this->yearMin, $this->yearMax);
        }

        if ($except !== 'power') {
            $this->range($query, 'vs.power_ps', $this->powerMin, $this->powerMax);
        }

        foreach (['drivetrain' => $this->drivetrain, 'gearbox' => $this->gearbox, 'fuel' => $this->fuel] as $column => $values) {
            if ($values !== [] && $except !== $column) {
                $query->whereIn('vs.'.$column, $values);
            }
        }

        $rows = [
            'wheel_diameter' => $this->wheelDiameters,
            'wheel_brand' => array_map(strval(...), array_values($this->wheelBrands)),
            'suspension_type' => $this->suspensionTypes,
            'suspension_brand' => array_map(strval(...), array_values($this->suspensionBrands)),
            'exhaust_brand' => array_map(strval(...), array_values($this->exhaustBrands)),
        ];

        foreach ($rows as $facet => $values) {
            if ($values !== [] && $except !== $facet) {
                // A lookup on the primary key (facet, value, vehicle_id) per candidate build.
                $query->whereExists(fn (Builder $exists) => $exists->selectRaw('1')->from('vehicle_search_facets', 'vsf')
                    ->whereColumn('vsf.vehicle_id', 'vs.vehicle_id')
                    ->where('vsf.facet', $facet)
                    ->whereIn('vsf.value', $values));
            }
        }

        if ($this->modCategories !== [] && $except !== 'mod_category') {
            $query->whereRaw('(vs.mod_category_mask & ?) <> 0', [array_sum(array_unique($this->modCategories))]);
        }

        return $query;
    }

    private function range(Builder $query, string $column, ?int $min, ?int $max): void
    {
        if ($min !== null) {
            $query->where($column, '>=', $min);
        }

        if ($max !== null) {
            $query->where($column, '<=', $max);
        }
    }
}
