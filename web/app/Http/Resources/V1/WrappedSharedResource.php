<?php

namespace App\Http\Resources\V1;

use App\Models\Wrapped;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * POST me/wrapped/{season_key}/shared (m5.9e contract §5): the counter after this share. The member's own number; nobody else sees it.
 *
 * @property Wrapped $resource
 */
class WrappedSharedResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'season_key' => $this->resource->season_key,
            /** How often the member opened the share sheet for this Wrapped (a dismissed sheet counts too; owner-only, CR-P5G-18). */
            'shared_count' => $this->resource->shared_count,
        ];
    }
}
