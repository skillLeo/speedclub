<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The public spot map (m5.9b contract §6): city aggregates of counted spots, never a vehicle.
 *
 * @property array{generated_at: string, cities: list<array{city_id: int, name: string, bundesland: string, count: int}>} $resource
 */
class SpotMapResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /**
             * When the numbers were counted (ISO 8601); the answer is cached for an hour.
             *
             * @var string
             */
            'generated_at' => $this->resource['generated_at'],
            /**
             * Cities with counted spots of at least 5 different cars between 24 hours and 90 days old, most spots first (`count` = spots). `city_id` is the id of the static
             * centroid file `/geo/de-cities.json`; `bundesland` a code BW…TH. Ghost cars and cars hiding their cities never count.
             *
             * @var list<array{city_id: int, name: string, bundesland: string, count: int}>
             */
            'cities' => $this->resource['cities'],
        ];
    }
}
