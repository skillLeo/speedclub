<?php

namespace App\Http\Resources\V1;

use App\Models\Media;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * DISC-01 "Beliebte Modelle" (09 §7.5): `key` opens DISC-03 (`discover/models/{key}`), with the count of builds the reader may see.
 *
 * @property array{key: string, make: string, name: string, vehicle_count: int, cover: Media|null} $resource
 */
class PopularModelResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'key' => $this->resource['key'],
            'make' => $this->resource['make'],
            'name' => $this->resource['name'],
            'vehicle_count' => $this->resource['vehicle_count'],
            'cover' => $this->resource['cover'] instanceof Media ? new MediaResource($this->resource['cover']) : null,
        ];
    }
}
