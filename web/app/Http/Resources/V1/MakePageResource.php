<?php

namespace App\Http\Resources\V1;

use App\Services\Discover\MakePage;
use App\Services\Discover\MakeTile;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * DISC-03: the make with its real count and its models with builds, most builds first.
 *
 * @property MakePage $resource
 */
class MakePageResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $page = $this->resource;
        $make = $page->make;

        return [
            'make' => new MakeTileResource(new MakeTile((int) $make->getKey(), (string) $make->getAttribute('name'), (string) $make->getAttribute('slug'), $page->count)),
            /** @var list<ModelCountResource> */
            'models' => ModelCountResource::collection($page->models),
        ];
    }
}
