<?php

namespace App\Http\Resources\V1;

use App\Services\Discover\CollectionCard;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A "Kollektion" card of DISC-01 (16:9): opens DISC-02 with `filters` and `sort`.
 *
 * @property CollectionCard $resource
 */
class CollectionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $card = $this->resource;

        return [
            /** Stable id ("bmw-m"). */
            'key' => $card->key,
            /** "BMW M Builds" */
            'title' => $card->title,
            /**
             * "M3, M4 und M2 ab 340 PS"
             *
             * @var string|null
             */
            'subtitle' => $card->subtitle,
            /**
             * A visible build's cover; null only when no build of the collection has a visible photo.
             *
             * @var MediaResource|null
             */
            'cover' => $card->cover === null ? null : new MediaResource($card->cover),
            /**
             * The query parameters of `search/vehicles`, only the set ones; lists as arrays.
             *
             * @var array{make?: string, model?: string, generation?: string, year_min?: int, year_max?: int, power_min?: int, power_max?: int, drivetrain?: list<string>, gearbox?: list<string>, fuel?: list<string>, wheel_diameter?: list<float>, wheel_brand?: list<string>, suspension_type?: list<string>, suspension_brand?: list<string>, exhaust_brand?: list<string>, mod_category?: list<string>}
             */
            'filters' => (object) $card->filters,
            /**
             * The sort to open DISC-02 with; null: the default (newest without a text).
             *
             * @var 'relevance'|'newest'|'updated'|'power'|null
             */
            'sort' => $card->sort?->value,
            /** Builds the viewer can find, stops at 1000 (`count_capped`). */
            'count' => $card->count,
            'count_capped' => $card->countCapped,
        ];
    }
}
