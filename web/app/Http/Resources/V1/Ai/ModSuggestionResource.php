<?php

namespace App\Http\Resources\V1\Ai;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @property array{category_key: string, fields: array<string, bool|float|int|string>} $resource
 */
class ModSuggestionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** An active mod category key (catalog/mod-categories). */
            'category_key' => $this->resource['category_key'],
            /**
             * Suggested values by field key of that category, each valid for the field (number in its unit, option value, catalogue brand
             * name, text). Only what the text stated; may be empty. Each one is accepted or discarded by the member; nothing is saved.
             *
             * @var array<string, bool|float|int|string>
             */
            'fields' => (object) $this->resource['fields'],
            /** "KI-Vorschlag". */
            'label' => (string) __('ai.label.suggestion'),
        ];
    }
}
