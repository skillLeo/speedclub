<?php

namespace App\Http\Resources\V1;

use App\Services\Home\PopularMod;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A chip of "Beliebte Mods diese Woche". No counts: what is popular shows by its place.
 *
 * @property PopularMod $resource
 */
class PopularModResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** "KW V3", "BBS" */
            'label' => $this->resource->label,
            /**
             * The mod category most of its mods are in ("suspension"), for the chip's icon.
             */
            'category_key' => $this->resource->categoryKey,
            /** What DISC-02 searches for when the chip is tapped (`q`). */
            'query' => $this->resource->query,
        ];
    }
}
