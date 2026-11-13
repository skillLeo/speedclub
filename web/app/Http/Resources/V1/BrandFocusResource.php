<?php

namespace App\Http\Resources\V1;

use App\Models\Media;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * HOME-01 "Marken im Fokus" (09 §7.3): a part brand with how many builds the reader may see run it (installed mods), and the newest of
 * their covers. Opens BRD-01 by slug (M4.14).
 *
 * @property array{slug: string, name: string, vehicle_count: int, cover: Media|null} $resource
 */
class BrandFocusResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'slug' => $this->resource['slug'],
            'name' => $this->resource['name'],
            'vehicle_count' => $this->resource['vehicle_count'],
            'cover' => $this->resource['cover'] instanceof Media ? new MediaResource($this->resource['cover']) : null,
        ];
    }
}
