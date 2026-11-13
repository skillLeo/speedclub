<?php

namespace App\Http\Resources\V1;

use App\Models\Vehicle;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * HOME-01 "Build der Woche" (09 §7.3): the build, the owner's own first sentence (or null), the ISO week.
 *
 * @property array{vehicle: Vehicle, quote: string|null, week: string} $resource
 */
class BuildOfWeekResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'vehicle' => new FeedVehicleResource($this->resource['vehicle']),
            /** The owner's own words from the description, never invented; null without a description. */
            'quote' => $this->resource['quote'],
            /** ISO week, "2026-W46". */
            'week' => $this->resource['week'],
        ];
    }
}
