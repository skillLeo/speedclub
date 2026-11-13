<?php

namespace App\Http\Resources\V1;

use App\Enums\RsvpStatus;
use App\Models\EventRsvp;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A row of EVT-04 Teilnehmer: the member and their answer. Members see going members; the organiser sees every answer with its time.
 *
 * @property EventRsvp $resource
 */
class EventAttendeeResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'member' => new MemberSummaryResource($this->resource->user),
            /** @var RsvpStatus */
            'status' => $this->resource->status,
            /** Since when; the organiser's list only, null for everybody else. */
            'status_at' => $this->resource->getAttribute('show_time') === true ? $this->resource->status_at->toIso8601String() : null,
        ];
    }
}
