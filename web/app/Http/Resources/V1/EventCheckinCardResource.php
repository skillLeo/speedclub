<?php

namespace App\Http\Resources\V1;

use App\Models\EventCheckin;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * M5.6 a row of GET me/checkins (PROF-01 "War dabei", the member's own): the EventCard (EventCardResource) plus when they checked in
 * and whether it shows on their profile. The event is prepared by EventPresenter.
 *
 * @property EventCheckin $resource
 */
class EventCheckinCardResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            ...(new EventCardResource($this->resource->event))->toArray($request),
            'checked_in_at' => $this->resource->checked_in_at->toIso8601String(),
            'profile_visible' => $this->resource->profile_visible,
        ];
    }
}
