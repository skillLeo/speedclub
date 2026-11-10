<?php

namespace App\Http\Resources\V1;

use App\Services\Discover\InterpretationChip;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An understood filter as a chip: "BMW", "M4", "G82", "2004", "ab 500 PS", "19″".
 *
 * @property InterpretationChip $resource
 */
class InterpretationChipResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** @var 'make'|'model'|'generation'|'year'|'power'|'wheel_diameter' */
            'field' => $this->resource->field,
            /** A slug, a diameter ("19.5"), or a range "min-max" for year ("2004-2004") and power ("500-"), as the app's chip ids. */
            'value' => $this->resource->value,
            /** Ready to show, in the request's language. */
            'label' => $this->resource->label,
            /**
             * The typed words this chip came from ("e46"); null when it follows from another chip (the make of "m4").
             *
             * @var string|null
             */
            'matched' => $this->resource->matched,
        ];
    }
}
