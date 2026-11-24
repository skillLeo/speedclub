<?php

namespace App\Http\Resources\V1;

use App\Models\Wrapped;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * GET me/wrapped, one row (m5.9e contract §5): a season the member has a Wrapped of.
 *
 * @property array{wrapped: Wrapped, released: bool} $resource
 */
class WrappedSeasonResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $wrapped = $this->resource['wrapped'];
        $released = $this->resource['released'];

        return [
            /** `2027-saison` (1 Mar–31 Oct) or `2027-jahr` (the calendar year). */
            'season_key' => $wrapped->season_key,
            /**
             * Whether it opens now; false until its release date (remote config `wrapped.releases`).
             *
             * @var bool
             */
            'released' => $released,
            'generated_at' => $wrapped->generated_at->toIso8601String(),
            /** The first time the member opened it; null before. */
            'viewed_at' => $wrapped->viewed_at?->toIso8601String(),
        ];
    }
}
