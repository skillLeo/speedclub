<?php

namespace App\Http\Resources\V1;

use App\Services\Discover\FacetSet;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * GET search/facets: the counts of the DISC-02 filter sheet and the live total for "124 Ergebnisse anzeigen". Each group counts with all
 * other active filters but not its own (makes also without model and generation, models without generation), so options of an active
 * group keep their counts. A value with 0 builds is left out unless it is active.
 *
 * @property FacetSet $resource
 */
class FacetsResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $set = $this->resource;
        $list = fn (array $facets) => FacetResource::collection($facets);

        return [
            /** Builds with every active filter; stops at 1000 (`total_capped`). */
            'total' => $set->total,
            'total_capped' => $set->totalCapped,
            /**
             * Most builds first, then by name.
             *
             * @var list<FacetResource>
             */
            'makes' => $list($set->makes),
            /**
             * Models of the active make; null without `make`.
             *
             * @var list<FacetResource>|null
             */
            'models' => $set->models === null ? null : $list($set->models),
            /**
             * Generations of the active model, oldest first; null without `model`.
             *
             * @var list<FacetResource>|null
             */
            'generations' => $set->generations === null ? null : $list($set->generations),
            /** @var list<FacetResource> */
            'drivetrain' => $list($set->drivetrain),
            /** @var list<FacetResource> */
            'gearbox' => $list($set->gearbox),
            /** @var list<FacetResource> */
            'fuel' => $list($set->fuel),
            /**
             * Ascending; front and rear sizes of every installed wheel set.
             *
             * @var list<FacetResource>
             */
            'wheel_diameter' => $list($set->wheelDiameter),
            /**
             * The 20 brands with the most builds, plus active ones.
             *
             * @var list<FacetResource>
             */
            'wheel_brand' => $list($set->wheelBrand),
            /** @var list<FacetResource> */
            'suspension_type' => $list($set->suspensionType),
            /**
             * The 20 brands with the most builds, plus active ones.
             *
             * @var list<FacetResource>
             */
            'suspension_brand' => $list($set->suspensionBrand),
            /**
             * The 20 brands with the most builds, plus active ones.
             *
             * @var list<FacetResource>
             */
            'exhaust_brand' => $list($set->exhaustBrand),
            /**
             * Categories with an installed mod, in the categories' order.
             *
             * @var list<FacetResource>
             */
            'mod_category' => $list($set->modCategory),
            /**
             * Model years of the builds the other filters leave; null when none has one.
             *
             * @var array{min: int, max: int}|null
             */
            'year' => $set->year,
            /**
             * PS of the builds the other filters leave; null when none has a figure.
             *
             * @var array{min: int, max: int}|null
             */
            'power' => $set->power,
        ];
    }
}
