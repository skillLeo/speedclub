<?php

namespace App\Http\Resources\V1;

use App\Services\Discover\Facet;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One option of the DISC-02 filter sheet: "BMW (12)". `value` is what the filter parameter takes.
 *
 * @property Facet $resource
 */
class FacetResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** The parameter value: a slug ("bmw"), an enum value ("rear"), a diameter ("19.5") or a category key. */
            'value' => $this->resource->value,
            /** Ready to show, in the request's language: "BMW", "Heck", "19,5″", "Räder & Reifen". */
            'label' => $this->resource->label,
            /** Builds with this value and every other active filter (disjunctive). 0 only for an active value. */
            'count' => $this->resource->count,
        ];
    }
}
