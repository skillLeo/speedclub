<?php

namespace App\Http\Resources\V1;

use App\Services\Discover\Interpretation;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * GET search/interpret: catalogue filters understood in a typed query. The app shows `chips` as removable filters next to the ones set,
 * applies `filters` and searches on with `remaining_q`. Nothing is applied that the chip row does not show.
 *
 * @property Interpretation $resource
 */
class InterpretationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /**
             * Under the parameter names of `search/vehicles`, only what was understood.
             *
             * @var array{make?: string, model?: string, generation?: string, year_min?: int, year_max?: int, power_min?: int, wheel_diameter?: list<float>}
             */
            'filters' => (object) $this->resource->filters,
            /**
             * One per understood filter: make, model, generation, year, power, wheel_diameter, in this order.
             *
             * @var list<InterpretationChipResource>
             */
            'chips' => InterpretationChipResource::collection($this->resource->chips),
            /** The words that were not understood, as typed; empty when everything was. */
            'remaining_q' => $this->resource->remainingQ,
        ];
    }
}
