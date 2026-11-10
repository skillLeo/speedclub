<?php

namespace App\Services\Discover;

/**
 * The answer of GET search/facets (SearchFacets).
 */
final readonly class FacetSet
{
    /**
     * @param  list<Facet>  $makes
     * @param  list<Facet>|null  $models  null unless a make is set
     * @param  list<Facet>|null  $generations  null unless a model is set
     * @param  list<Facet>  $drivetrain
     * @param  list<Facet>  $gearbox
     * @param  list<Facet>  $fuel
     * @param  list<Facet>  $wheelDiameter
     * @param  list<Facet>  $wheelBrand
     * @param  list<Facet>  $suspensionType
     * @param  list<Facet>  $suspensionBrand
     * @param  list<Facet>  $exhaustBrand
     * @param  list<Facet>  $modCategory
     * @param  array{min: int, max: int}|null  $year
     * @param  array{min: int, max: int}|null  $power
     */
    public function __construct(
        public int $total,
        public bool $totalCapped,
        public array $makes,
        public ?array $models,
        public ?array $generations,
        public array $drivetrain,
        public array $gearbox,
        public array $fuel,
        public array $wheelDiameter,
        public array $wheelBrand,
        public array $suspensionType,
        public array $suspensionBrand,
        public array $exhaustBrand,
        public array $modCategory,
        public ?array $year,
        public ?array $power,
    ) {}
}
