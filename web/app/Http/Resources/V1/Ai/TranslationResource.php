<?php

namespace App\Http\Resources\V1\Ai;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @property array{text: string, cached: bool, to: string} $resource
 */
class TranslationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'text' => $this->resource['text'],
            /** @var 'de'|'en' */
            'to' => $this->resource['to'],
            /** "Übersetzt" (EU AI Act Art. 50), shown with "Original anzeigen". */
            'label' => (string) __('ai.label.translated'),
            /** Whether the translation came from the 30-day cache. */
            'cached' => (bool) $this->resource['cached'],
        ];
    }
}
