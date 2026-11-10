<?php

namespace App\Http\Resources\V1;

use App\Models\Make;
use App\Services\Discover\MakeTile;
use App\Services\Discover\ModelCount;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * DISC-04 header: the model, its make and the generation chips with counts.
 *
 * @property array{model: ModelCount, make: Make, make_count: int} $resource
 */
class ModelPageResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $make = $this->resource['make'];

        return [
            'model' => new ModelSummaryResource($this->resource['model']),
            'make' => new MakeTileResource(new MakeTile((int) $make->getKey(), (string) $make->getAttribute('name'), (string) $make->getAttribute('slug'), $this->resource['make_count'])),
            /**
             * Generations with at least one build, oldest first, for `?generation=`.
             *
             * @var list<GenerationCountResource>
             */
            'generations' => GenerationCountResource::collection($this->resource['model']->generations),
        ];
    }
}
