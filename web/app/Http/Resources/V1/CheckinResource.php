<?php

namespace App\Http\Resources\V1;

use App\Models\EventCheckin;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * M5.6 the member's own check-in, the answer of POST/PATCH events/{slug}/checkin. Load with event.
 *
 * @property EventCheckin $resource
 */
class CheckinResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'checked_in_at' => $this->resource->checked_in_at->toIso8601String(),
            'profile_visible' => $this->resource->profile_visible,
            'event' => new EventRefResource($this->resource->event),
        ];
    }
}
