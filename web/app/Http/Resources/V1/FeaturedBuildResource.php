<?php

namespace App\Http\Resources\V1;

use App\Services\Discover\FeaturedBuild;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A slot of the featured hero of FS-2 (16:9 photo, eyebrow "FEATURED BUILD", title, "@lukas.sc · Stuttgart").
 *
 * @property FeaturedBuild $resource
 */
class FeaturedBuildResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** `editorial` from the curated list, `completeness` when the list left the slot empty. */
            'source' => $this->resource->source,
            'vehicle' => new FeedVehicleResource($this->resource->vehicle),
        ];
    }
}
