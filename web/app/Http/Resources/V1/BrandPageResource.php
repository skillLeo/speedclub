<?php

namespace App\Http\Resources\V1;

use App\Models\Brand;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * BRD-01 Marke (09 §7.11): wordmark hero, "about" from the catalogue (null when the catalogue has none), product lines and real counts.
 * The products follow from `brands/{slug}/products`, the builds wall from `brands/{slug}/builds`.
 *
 * @property array{brand: Brand, builds: int, products: int, lines: list<array{name: string, products: int}>} $resource
 */
class BrandPageResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $brand = $this->resource['brand'];
        $about = is_array($brand->about) ? ($brand->about[app()->getLocale()] ?? $brand->about['de'] ?? null) : null;

        return [
            'slug' => $brand->slug,
            'name' => $brand->name,
            /** One or two sentences from the catalogue, in the reader's language; null when the catalogue has none. */
            'about' => is_string($about) ? $about : null,
            /** The official website. @var string|null */
            'website' => $brand->website,
            /** ISO 3166-1 alpha-2. @var string|null */
            'country' => $brand->country,
            /** The mod category key the brand is best known for. @var string|null */
            'category' => $brand->category_hint,
            /** Visible builds with a mod of this brand ("1.204 Builds"), a real count. */
            'builds' => $this->resource['builds'],
            /** Active products in the catalogue. */
            'products' => $this->resource['products'],
            /**
             * Product lines with their number of active products, by name.
             *
             * @var list<array{name: string, products: int}>
             */
            'lines' => $this->resource['lines'],
            /** "/brands/kw" */
            'share_path' => '/brands/'.$brand->slug,
        ];
    }
}
