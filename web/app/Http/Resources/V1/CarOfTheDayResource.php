<?php

namespace App\Http\Resources\V1;

use App\Models\CarOfTheDay;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * HOME-01 lead module "Car of the Day" (m5.9d contract §3, §10.3, ADR-510), from 18:00 to the next day's 18:00.
 *
 * @property array{pick: CarOfTheDay, vehicle: Vehicle} $resource
 */
class CarOfTheDayResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $vehicle = $this->resource['vehicle'];
        $owner = $vehicle->owner;

        return [
            /** The Europe/Berlin day of the pick, "2026-11-14" (published at 18:00). */
            'day' => $this->resource['pick']->dayString(),
            /** @var string|null The owner's line (≤ 140), at first the first sentence of their description; null without one. */
            'story_line' => $this->resource['pick']->story_line,
            'vehicle' => new FeedVehicleResource($vehicle),
            /** @var MemberSummaryResource|null */
            'owner' => $owner instanceof User ? new MemberSummaryResource($owner) : null,
            /** A sample build (staging and local only, never in production): the "Beispiel" badge. */
            'is_sample' => (bool) $this->resource['pick']->is_sample,
        ];
    }
}
