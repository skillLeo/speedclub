<?php

namespace App\Http\Resources\V1;

use App\Enums\ProductStatus;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A ProductRow (09 §5): brand wordmark + product + category + "In 14 Builds". The mod editor's autocomplete reads the same rows.
 *
 * @property Product $resource
 */
class ProductRowResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $product = $this->resource;
        $category = $product->category;

        return [
            'id' => $product->id,
            'slug' => $product->slug,
            /** "Variante 3" */
            'name' => $product->name,
            /** "KW Variante 3" */
            'full_name' => $product->fullName(),
            /** @var string|null */
            'line' => $product->line,
            /** @var array{slug: string, name: string} */
            'brand' => ['slug' => $product->brand->slug, 'name' => $product->brand->name],
            /** @var array{key: string, name: string, icon: string|null} */
            'category' => [
                'key' => $category->key,
                'name' => $category->getTranslation('name', app()->getLocale()),
                'icon' => $category->getAttribute('icon'),
            ],
            /**
             * Visible real builds with this product (samples never count, DQ-1140; 0 = hide the number); null where the list does not
             * count (the editor's autocomplete).
             *
             * @var int|null
             */
            'builds' => $product->buildCount,
            /**
             * ADR-457: the cover of the newest real public build with this product (1:1 thumbnail at radius 8); null when there is none
             * (the client shows the category glyph) or the list does not count (the editor's autocomplete).
             *
             * @var MediaResource|null
             */
            'thumbnail' => $product->thumbnail === null ? null : new MediaResource($product->thumbnail),
            /** @var ProductStatus */
            'status' => $product->status,
        ];
    }
}
