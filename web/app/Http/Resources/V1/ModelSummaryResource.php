<?php

namespace App\Http\Resources\V1;

use App\Services\Discover\ModelCount;
use App\Services\Discover\ModelKey;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A catalogue model with its real number of builds (DISC-04 header).
 *
 * @property ModelCount $resource
 */
class ModelSummaryResource extends JsonResource
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
            /** Unique within its make only: `model` of DISC-02 goes with `make`. */
            'slug' => (string) $model->getAttribute('slug'),
            /** The DISC-04 route key, "bmw--m4": `discover/models/{key}`. */
            'key' => ModelKey::of($model),
            'vehicle_count' => $this->resource->count,
        ];
    }
}
