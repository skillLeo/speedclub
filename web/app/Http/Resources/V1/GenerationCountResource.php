<?php

namespace App\Http\Resources\V1;

use App\Services\Discover\GenerationCount;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A generation chip of DISC-03/04 with its real number of builds.
 *
 * @property GenerationCount $resource
 */
class GenerationCountResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $generation = $this->resource->generation;

        return [
            /** "G82" */
            'name' => (string) $generation->getAttribute('name'),
            /** For `?generation=`. */
            'slug' => (string) $generation->getAttribute('slug'),
            /** @var int|null */
            'year_from' => $generation->getAttribute('year_from'),
            /**
             * Null while it is still built.
             *
             * @var int|null
             */
            'year_to' => $generation->getAttribute('year_to'),
            'vehicle_count' => $this->resource->count,
        ];
    }
}
