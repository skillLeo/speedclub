<?php

namespace App\Http\Resources\V1\Ai;

use App\Http\Resources\V1\ProductRowResource;
use App\Models\Product;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * M5.9 mod editor product match (m5.9-contract §2.2): catalogue products only.
 *
 * @property array{normalized: string|null, products: Collection<int, Product>, ai: bool} $resource
 */
class ProductMatchResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** "KI-Vorschlag" when the AI normalised the text; null when the catalogue matched the words directly. */
            'label' => $this->resource['ai'] ? (string) __('ai.label.suggestion') : null,
            /** The catalogue words the AI made of the text, e.g. "KW Variant 3"; null without the AI. */
            'normalized' => $this->resource['normalized'],
            /**
             * At most 3 active catalogue products; empty when nothing matches (the app offers "Nicht gefunden?").
             *
             * @var array<int, ProductRowResource>
             */
            'products' => ProductRowResource::collection($this->resource['products']),
        ];
    }
}
