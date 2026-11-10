<?php

namespace App\Http\Resources\V1\Ai;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @property array{text: string} $resource
 */
class DescriptionSuggestionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** At most 600 characters, from the vehicle's structured data only; every number in it stands in that data. */
            'text' => $this->resource['text'],
            /** "KI-Vorschlag", shown until the member edits the text. */
            'label' => (string) __('ai.label.suggestion'),
        ];
    }
}
