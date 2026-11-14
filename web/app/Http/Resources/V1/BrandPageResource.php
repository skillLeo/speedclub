<?php

namespace App\Http\Resources\V1;

use App\Models\Brand;
use App\Models\Media;
use App\Models\Product;
use App\Models\Vehicle;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * BRD-01 Marke (09 §7.11): wordmark hero, "about" from the catalogue (null when the catalogue has none), product lines and real counts.
 * The products follow from `brands/{slug}/products`, the builds wall from `brands/{slug}/builds`.
 *
 * @property array{brand: Brand, builds: int, products: int, lines: list<array{name: string, products: int}>, lead_photo: array{vehicle: Vehicle, photo: Media, product: Product|null}|null, build_photos: list<array{vehicle: Vehicle, photo: Media, product: Product|null}>} $resource
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
            /** Visible real builds with a mod of this brand ("1.204 Builds"); samples never count (DQ-1140), 0 = hide the number. */
            'builds' => $this->resource['builds'],
            /** Active products in the catalogue. */
            'products' => $this->resource['products'],
            /**
             * Product lines with their number of active products, by name.
             *
             * @var list<array{name: string, products: int}>
             */
            'lines' => $this->resource['lines'],
            /**
             * ADR-457: the lead photo, a build carrying the brand's most-used product (a real build; a sample only while samples are shown,
             * badged by `vehicle.is_sample`); null when no build with a photo carries one.
             *
             * @var BuildPhotoResource|null
             */
            'lead_photo' => $this->resource['lead_photo'] === null ? null : new BuildPhotoResource($this->resource['lead_photo']),
            /**
             * ADR-457 "Beliebt in Builds": up to 8 builds with a mod of the brand, real builds before samples.
             *
             * @var array<int, BuildPhotoResource>
             */
            'build_photos' => BuildPhotoResource::collection($this->resource['build_photos']),
            /** "/brands/kw" */
            'share_path' => '/brands/'.$brand->slug,
        ];
    }
}
