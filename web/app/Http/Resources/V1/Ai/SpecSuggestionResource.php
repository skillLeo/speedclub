<?php

namespace App\Http\Resources\V1\Ai;

use App\Actions\Ai\SuggestVehicleSpecs;
use App\Models\AiSpecSuggestion;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * M5.9 "Daten übernehmen?" (m5.9-contract §2.1).
 *
 * @phpstan-import-type Variant from SuggestVehicleSpecs
 *
 * @property array{suggestion: AiSpecSuggestion, subject: string, cached: bool} $resource
 */
class SpecSuggestionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $suggestion = $this->resource['suggestion'];

        return [
            /** Send it back as `ai_suggestion.cache_id` with PUT vehicles/{id}/specs, so the taken values carry their AI provenance. */
            'cache_id' => $suggestion->id,
            /** "KI-Vorschlag" next to the row. */
            'label' => (string) __('ai.label.suggestion'),
            /** "Herstellerangabe (KI-Vorschlag)": the source of power and torque taken over, until the member changes them. */
            'provenance_label' => (string) __('ai.label.factory_suggestion'),
            /** The catalogue's name of the car, e.g. "BMW 3er E46 (1998–2006)"; never the member's text. */
            'subject' => $this->resource['subject'],
            /**
             * Up to 6 typical factory variants; each `fields` holds only valid PUT vehicles/{id}/specs values (power_value with power_unit).
             *
             * @var list<array{key: string, label: string, fields: array<string, string|int|float>}>
             */
            'variants' => $suggestion->payload,
            /** Whether the answer came from the shared cache (no provider call). */
            'cached' => (bool) $this->resource['cached'],
            'generated_at' => $suggestion->created_at?->toIso8601String(),
        ];
    }
}
