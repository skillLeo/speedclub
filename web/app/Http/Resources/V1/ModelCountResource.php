<?php

namespace App\Http\Resources\V1;

use App\Services\Discover\ModelCount;
use App\Services\Discover\ModelKey;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A model row of DISC-03: name, real count and its generation chips.
 *
 * @property ModelCount $resource
 */
class ModelCountResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $model = $this->resource->model;

        return [
            'id' => (int) $model->getKey(),
            /** "M4" */
            'name' => (string) $model->getAttribute('name'),
            /** Unique within its make only. */
            'slug' => (string) $model->getAttribute('slug'),
            /** The DISC-04 route key, "bmw--m4". */
            'key' => ModelKey::of($model),
            'vehicle_count' => $this->resource->count,
            /** M4.9: the newest visible build's cover of the model (make page only), or null. */
            'cover' => $this->resource->cover === null ? null : new MediaResource($this->resource->cover),
            /**
             * Generations with at least one build, oldest first.
             *
             * @var list<GenerationCountResource>
             */
            'generations' => GenerationCountResource::collection($this->resource->generations),
        ];
    }
}
