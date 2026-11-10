<?php

namespace App\Http\Resources\V1\Ai;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @property list<array{facet: string, value: string, label: string}> $resource
 */
class SearchInterpretationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /**
             * Discover filter chips (DISC-02): `facet` is a filter parameter (make, model, generation, year_min, year_max, power_min,
             * power_max, drivetrain, gearbox, fuel, wheel_diameter, wheel_brand, suspension_type, suspension_brand, exhaust_brand,
             * mod_category), `value` its value as the search takes it (a slug, an enum value, a number), `label` what the chip shows.
             * Applied as normal, editable chips. May be empty.
             *
             * @var list<array{facet: 'make'|'model'|'generation'|'year_min'|'year_max'|'power_min'|'power_max'|'drivetrain'|'gearbox'|'fuel'|'wheel_diameter'|'wheel_brand'|'suspension_type'|'suspension_brand'|'exhaust_brand'|'mod_category', value: string, label: string}>
             */
            'chips' => $this->resource,
            /** "KI-Vorschlag" (EU AI Act Art. 50), in the request's language. */
            'label' => (string) __('ai.label.suggestion'),
        ];
    }
}
