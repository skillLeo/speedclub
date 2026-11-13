<?php

namespace App\Http\Resources\V1;

use App\Models\Brand;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A BrandTile (09 §5): the wordmark is the brand's name in Archivo SemiExpanded on the client; the real number of visible builds.
 *
 * @property array{brand: Brand, builds: int} $resource
 */
class BrandTileResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $brand = $this->resource['brand'];

        return [
            'slug' => $brand->slug,
            'name' => $brand->name,
            /** Visible builds with a mod of this brand, a real count. */
            'builds' => $this->resource['builds'],
        ];
    }
}
