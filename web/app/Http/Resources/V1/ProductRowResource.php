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
             * Visible builds with this product, a real count; null where the list does not count (the editor's autocomplete).
             *
             * @var int|null
             */
            'builds' => $product->buildCount,
            /** @var ProductStatus */
            'status' => $product->status,
        ];
    }
}
