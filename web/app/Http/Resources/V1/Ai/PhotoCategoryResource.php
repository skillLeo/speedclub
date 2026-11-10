<?php

namespace App\Http\Resources\V1\Ai;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @property array{category: string, label: string} $resource
 */
class PhotoCategoryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** @var 'exterior'|'interior'|'engine'|'wheels'|'detail' */
            'category' => $this->resource['category'],
            /** The category's name, e.g. "Innenraum". */
            'category_label' => $this->resource['label'],
            /** "KI-Vorschlag". */
            'label' => (string) __('ai.label.suggestion'),
        ];
    }
}
